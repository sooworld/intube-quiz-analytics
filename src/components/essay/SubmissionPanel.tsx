"use client";
// 서술형 채점 패널 (AI 우선 배치, 2026-11-11). 왼쪽은 답안과 근거 하이라이트, 오른쪽은 AI 제안과 결정.
// 결정은 세 가지다: 수락(valid 제안 그대로) · 수정(제안 수준에서 시작) · 직접 채점(근거 제안을 떼어 냄).
// 확정 출처는 decideFinal → finalSourceFor 정의를 그대로 따른다(docs/decisions.md §6.3·§6.4).
import { useEffect, useRef, useState } from "react";
import { AiErrorNote, AiWaitText } from "@/components/ai/AiRunStatus";
import { InfoTip } from "@/components/moodle/InfoTip";
import { providerModelLabel } from "@/lib/ai/capabilities";
import type { StoredSuggestion } from "@/lib/ai/types";
import type { WaitGuide } from "@/lib/ai/wait";
import { charCount, systemFlags } from "@/lib/ai/validate";
import { GradeActionError, suggestionLevels, type FinalSource, type GradeRecord } from "@/lib/essay/grades";
import { acceptLevels, canAccept, decideFinal, rowStatus } from "@/lib/essay/queue";
import { formatDateTime } from "@/lib/format";
import type { useEssay } from "@/lib/state/EssayContext";
import type { CriterionLevels, EssayItem, EssaySubmission, RubricLevel } from "@/lib/types";
import { STATUS_TEXT } from "./GradingQueue";
import { HighlightedEssay } from "./HighlightedEssay";

type Dispatchable = Parameters<ReturnType<typeof useEssay>["dispatch"]>[0];

/** idle: 쓸 수 있는 제안이 없어 편집 칸을 닫아 둠 · view: 제안을 읽는 중 · edit: 제안 수준에서 고침 · manual: 직접 채점 */
type Mode = "idle" | "view" | "edit" | "manual";

const SOURCE_TEXT: Record<FinalSource, string> = { accepted: "AI 제안 수락", edited: "수정 후 확정", manual: "직접 채점" };
const ACTION_TEXT: Record<FinalSource, string> = { accepted: "AI 제안 수락", edited: "수정 후 확정", manual: "직접 채점 확정" };
const FLAG_TEXT: Record<string, string> = {
  empty: "무응답",
  "over-limit": "글자 수 초과(감점 없음)",
  "off-topic": "주제 이탈 의심",
  "injection-suspected": "채점 지시문 의심",
  "insufficient-content": "내용 부족",
};

const usableOf = (s: StoredSuggestion | undefined) => (s && s.result.status !== "invalid" ? s : undefined);
/** 제안을 불러올 때의 시작 모드: valid는 읽기, needs-review는 수락 없이 바로 고치기, 없거나 invalid면 닫아 둠 */
const modeFor = (s: StoredSuggestion | undefined): Mode => (!s || s.result.status === "invalid" ? "idle" : s.result.status === "valid" ? "view" : "edit");

export interface NextInfo {
  label: string;
  go: () => void;
}

export function SubmissionPanel(props: {
  item: EssayItem;
  sub: EssaySubmission;
  record: GradeRecord | undefined;
  studentName: string;
  recordKey: string;
  pending: boolean;
  error: string | null;
  /** 오류가 다시 보내면 풀릴 수 있는 종류인지 */
  errorRetryable: boolean;
  /** 개별 요청을 막는 이유가 있을 때(키 없음, 일괄 실행 중 등) */
  requestDisabled: boolean;
  /** 같은 설정의 제안이 이미 있음(다시 받으면 새로 부른다) */
  cached: boolean;
  /** 마지막 요청의 호출 수·소요 시간·오늘 예산(기본 AI 중계일 때만) */
  runInfo: string | null;
  /** 대기 안내(보통 걸리는 시간·한도). Mock은 null */
  wait: WaitGuide | null;
  next: NextInfo | null;
  /** 마운트할 때 초점을 둘 곳 (확정 직후: 다음 버튼, 다음 답안으로 왔을 때: 제목) */
  focusOnMount: "title" | "next" | null;
  onRequest: (force: boolean) => void;
  onCancel: () => void;
  onAction: (a: Dispatchable) => void;
}) {
  const { item, sub, record, pending } = props;
  const suggestions = record?.suggestions ?? [];
  const final = record?.final;
  // 다시 연 기록은 직전 확정 값에서 시작한다(교수가 정한 값을 버리지 않게)
  const previous = record?.previousFinals?.[record.previousFinals.length - 1];
  const latestId = suggestions[suggestions.length - 1]?.suggestionId;

  const startId = (final ?? previous)?.basedOnSuggestionId ?? latestId;
  const [viewId, setViewId] = useState<string | undefined>(startId);
  const viewed = suggestions.find((s) => s.suggestionId === viewId);
  const usable = usableOf(viewed);
  const [mode, setMode] = useState<Mode>(() => (previous && !final ? (previous.source === "manual" ? "manual" : "edit") : modeFor(viewed)));
  const [levels, setLevels] = useState<Partial<CriterionLevels>>(() => (final ?? previous)?.levels ?? (usable ? suggestionLevels(usable) : {}));
  const [feedback, setFeedback] = useState((final ?? previous)?.feedback ?? usable?.result.feedbackDraft ?? "");
  /** 교수가 값을 고쳤는지. 고치는 중이면 새 제안이 와도 덮어쓰지 않는다 */
  const [dirty, setDirty] = useState(!final && !!previous);
  const [seenLatest, setSeenLatest] = useState(latestId);
  const [newArrived, setNewArrived] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** 기준에 마우스를 올리면 답안의 해당 근거 구간을 강조한다(인용문을 패널에 다시 쓰지 않는다) */
  const [activeCriterion, setActiveCriterion] = useState<number | null>(null);
  /** 근거 문장은 2줄로 접어 두고 한 번에 펼친다 */
  const [showRationale, setShowRationale] = useState(false);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (props.focusOnMount === "title") titleRef.current?.focus();
    if (props.focusOnMount === "next") nextRef.current?.focus();
  }, [props.focusOnMount]);

  const load = (id: string | undefined) => {
    const s = suggestions.find((x) => x.suggestionId === id);
    const ok = usableOf(s);
    setViewId(id);
    setMode(modeFor(s));
    setLevels(ok ? suggestionLevels(ok) : {});
    setFeedback(ok?.result.feedbackDraft ?? "");
    setDirty(false);
    setNewArrived(false);
    setActionError(null);
  };

  // 새 제안이 도착했을 때(일괄 실행 포함): 고치는 중이 아니면 새 제안을 보여 주고, 고치는 중이면 알리기만 한다.
  // 렌더 중 상태 조정은 React가 권장하는 "prop 변화에 맞춘 상태 조정" 방식이다.
  if (latestId !== seenLatest) {
    setSeenLatest(latestId);
    if (!final) {
      if (dirty) setNewArrived(true);
      else load(latestId);
    }
  }

  const complete = item.rubric.every((c) => levels[c.id] !== undefined);
  const decisionMode = mode === "manual" ? "manual" : "review";
  const pendingSource = complete ? decideFinal(decisionMode, levels as CriterionLevels, usable).source : null;
  const total = item.rubric.reduce((s, c) => s + (levels[c.id] ?? 0), 0);
  const text = sub.text;
  const chars = text === null ? 0 : charCount(text);
  const flags = usable?.result.flags ?? viewed?.result.flags ?? systemFlags(item, text);
  const rubricIndex = (criterionId: string) => item.rubric.findIndex((r) => r.id === criterionId);

  const finalize = (finalLevels: CriterionLevels, modeForDecision: "review" | "manual") => {
    setActionError(null);
    const decision = decideFinal(modeForDecision, finalLevels, usable);
    try {
      props.onAction({ type: "finalize", key: props.recordKey, item, levels: finalLevels, feedback, ...decision, decidedAt: new Date().toISOString() });
    } catch (e) {
      setActionError(e instanceof GradeActionError ? e.message : "확정하지 못했습니다.");
    }
  };

  const startManual = () => {
    setMode("manual");
    setLevels({});
    setDirty(true);
    setActionError(null);
  };

  const highlights = (usable?.result.criteria ?? [])
    .map((c) => (c.span ? { span: c.span, index: rubricIndex(c.criterionId), label: item.rubric.find((r) => r.id === c.criterionId)?.name ?? c.criterionId } : null))
    .filter((h): h is NonNullable<typeof h> => h !== null);

  const editing = !final && (mode === "edit" || mode === "manual");
  const showSuggestionDetail = !!usable && mode !== "manual";
  // 제안 정보 줄은 예외일 때만 보인다: 기본 AI가 아닌 제공자(Mock 포함)이거나 검증 통과가 아닐 때
  const metaWho = !viewed || viewed.provider === "lg" ? null : viewed.provider === "mock" ? "규칙 기반 모의 채점(AI 아님)" : providerModelLabel(viewed.provider, viewed.model, true);
  const metaStatus =
    !viewed || viewed.result.status === "valid" ? null : viewed.result.status === "needs-review" ? "검토 필요 — 수락할 수 없고 수정 후 확정만 됩니다" : "검증 실패 — 직접 채점하세요";
  const hover = (ci: number) => ({ onMouseEnter: () => setActiveCriterion(ci), onMouseLeave: () => setActiveCriterion(null) });

  return (
    <div className="gw-panel">
      <section className="card gw-essay" aria-labelledby="gw-panel-title">
        <h2 className="card-title" id="gw-panel-title" ref={titleRef} tabIndex={-1}>
          {props.studentName}
        </h2>
        <p className="small muted">
          {text === null ? "무응답" : `${chars}/${item.charLimit}자`}
          {flags.map((f) => (
            <span key={f} className={`badge ${f === "injection-suspected" || f === "off-topic" ? "badge-warn" : ""}`} style={{ marginLeft: 6 }}>
              {FLAG_TEXT[f] ?? f}
            </span>
          ))}
        </p>
        <details className="small">
          <summary>문항 보기</summary>
          <p>{item.stem}</p>
        </details>
        <div className="essay-box">
          {text === null ? <p className="muted">(제출된 답안이 없습니다)</p> : <HighlightedEssay text={text} highlights={highlights} active={activeCriterion} />}
        </div>
      </section>

      <section className="card gw-ai" aria-labelledby="gw-ai-title">
        <h2 className="card-title" id="gw-ai-title">
          AI 채점 제안
          <InfoTip label="AI 채점 제안">
            <span>AI 채점 제안은 참고 자료입니다. 확정 전 점수는 결과 분석에 들어가지 않습니다.</span>
            <span>답안의 색 표시는 기준별 근거 인용입니다. 기준에 마우스를 올리면 그 구간이 강조됩니다.</span>
          </InfoTip>
        </h2>

        {!final ? (
          <div className="btn-row">
            <button
              type="button"
              className={`btn ${suggestions.length === 0 ? "btn-primary" : "btn-outline"}`}
              disabled={pending || props.requestDisabled}
              onClick={() => props.onRequest(suggestions.length > 0 && props.cached)}
            >
              {pending ? "제안 받는 중…" : suggestions.length === 0 ? "이 답안 AI 제안 받기" : props.cached ? "다시 제안 받기" : "현재 설정으로 제안 받기"}
            </button>
            {pending ? (
              <button type="button" className="btn btn-link" onClick={props.onCancel}>
                취소
              </button>
            ) : null}
          </div>
        ) : null}
        {pending ? (
          <p className="small muted" role="status">
            <AiWaitText wait={props.wait} what="AI가 채점 제안을 쓰는 중입니다." /> 기다리는 동안 다른 답안을 검토해도 됩니다.
          </p>
        ) : null}
        {!pending && props.runInfo ? <p className="small muted">{props.runInfo}</p> : null}
        {props.error ? <AiErrorNote error={props.error} retryable={props.errorRetryable} disabled={props.requestDisabled} onRetry={() => props.onRequest(suggestions.length > 0 && props.cached)} /> : null}
        {newArrived ? (
          <div className="alert alert-info" role="status">
            <p className="small">
              새 제안이 도착했습니다. 고치던 값은 그대로 두었습니다.{" "}
              <button type="button" className="btn-link" onClick={() => load(latestId)}>
                새 제안 불러오기
              </button>
            </p>
          </div>
        ) : null}
        {!final && previous ? <p className="small muted">다시 연 기록입니다. 직전 확정 값({SOURCE_TEXT[previous.source]})에서 시작합니다.</p> : null}

        {suggestions.length > 1 ? (
          <label className="small gw-history" title="이력을 바꾸면 그 제안의 수준과 피드백을 불러옵니다(고치던 값은 사라집니다)">
            제안 이력{" "}
            <select value={viewId} onChange={(e) => load(e.target.value)} disabled={!!final}>
              {suggestions.map((s, i) => (
                <option key={s.suggestionId} value={s.suggestionId}>
                  #{i + 1} {providerModelLabel(s.provider, s.model, true)} · {STATUS_TEXT[rowStatus({ suggestions: [s] })]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {viewed && (metaWho || metaStatus || viewed.result.problems.length) ? (
          <div className={`suggestion-meta status-${viewed.result.status}`} title={formatDateTime(viewed.createdAt)}>
            <p className="small">
              {metaWho ? <strong>{metaWho}</strong> : null}
              {metaWho && metaStatus ? " · " : null}
              {metaStatus}
            </p>
            {viewed.result.problems.length ? (
              <ul className="small">
                {viewed.result.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {usable && showSuggestionDetail ? (
          <div className="gw-ai-score-row">
            <p className="gw-ai-score" title={formatDateTime(usable.createdAt)}>
              AI 제안 {usable.result.total} <span className="small muted">/ {item.maxScore}</span>
            </p>
            <button type="button" className="btn-link small" aria-expanded={showRationale} onClick={() => setShowRationale((v) => !v)}>
              {showRationale ? "근거 접기" : "근거 펼치기"}
            </button>
          </div>
        ) : null}

        {editing ? (
          <div className="gw-editor">
            <p className="small">
              <strong>{mode === "manual" ? "직접 채점" : "수정"}</strong> — 기준마다 수준을 고르세요.{mode === "manual" && usable ? " AI 제안은 근거로 남기지 않습니다." : ""}
            </p>
            <ol className={`gw-criteria${showRationale ? "" : " is-clamped"}`}>
              {item.rubric.map((c, ci) => {
                const sc = showSuggestionDetail ? usable?.result.criteria.find((x) => x.criterionId === c.id) : undefined;
                return (
                  <li key={c.id} className="gw-criterion" {...hover(ci)}>
                    <fieldset className="gw-levels">
                      <legend className="gw-criterion-head">
                        <span>
                          <span className={`gw-swatch hl hl-${ci}`} aria-hidden="true" />
                          {c.name}
                        </span>
                      </legend>
                      {c.levels.map((l) => {
                        const id = `${props.recordKey}-${c.id}-${l.level}`;
                        return (
                          <label key={l.level} htmlFor={id} className={`gw-level${sc?.level === l.level ? " ai-pick" : ""}`}>
                            <input
                              id={id}
                              type="radio"
                              name={`${props.recordKey}-${c.id}`}
                              checked={levels[c.id] === l.level}
                              onChange={() => {
                                setLevels((v) => ({ ...v, [c.id]: l.level as RubricLevel }));
                                setDirty(true);
                              }}
                            />
                            <span>
                              {l.level} · {l.label}
                              {sc?.level === l.level ? <span className="ai-tag">AI</span> : null}
                              <span className="gw-level-desc">{l.descriptor}</span>
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                    {sc ? <p className="small muted rationale">{sc.rationale}</p> : null}
                  </li>
                );
              })}
            </ol>
            <p className="small">
              합계: <strong>{complete ? `${total} / ${item.maxScore}` : "모든 기준을 고르세요"}</strong>
              {usable && mode !== "manual" ? <span className="muted"> (AI 제안 {usable.result.total})</span> : null}
            </p>
          </div>
        ) : final || (usable && showSuggestionDetail) ? (
          <ol className={`gw-criteria${showRationale ? "" : " is-clamped"}`}>
            {item.rubric.map((c, ci) => {
              const sc = showSuggestionDetail ? usable?.result.criteria.find((x) => x.criterionId === c.id) : undefined;
              const pick = sc ? c.levels.find((l) => l.level === sc.level) : undefined;
              const shown = final ? c.levels.find((l) => l.level === final.levels[c.id]) : undefined;
              const level = final ? shown : pick;
              return (
                <li key={c.id} className="gw-criterion" {...hover(ci)}>
                  <div className="gw-criterion-head">
                    <span>
                      <span className={`gw-swatch hl hl-${ci}`} aria-hidden="true" />
                      {c.name}
                    </span>
                    <span className="gw-level-chip">{level ? `${level.level} · ${level.label}` : "–"}</span>
                  </div>
                  {sc ? (
                    <>
                      <p className="small rationale">{sc.rationale}</p>
                      {/* 인용은 답안의 색 표시로 보인다. 답안에서 찾지 못한 인용만 여기에 쓴다 */}
                      {sc.evidenceQuote && !sc.span ? <p className="gw-quote">&ldquo;{sc.evidenceQuote}&rdquo;</p> : null}
                      {sc.issues.includes("quote-mismatch") ? <p className="small text-danger">근거 인용이 답안에 없습니다</p> : null}
                      {sc.issues.includes("no-evidence") ? <p className="small text-danger">근거 인용이 없습니다</p> : null}
                      {sc.issues.includes("quote-in-instruction") ? <p className="small text-danger">답안 속 채점 지시문을 근거로 인용했습니다</p> : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}

        {final || mode !== "idle" ? (
          <label className="field">
            <span>학생 피드백{usable && mode !== "manual" && !final ? " (AI 초안)" : ""}</span>
            <textarea
              rows={4}
              value={feedback}
              disabled={!!final}
              onChange={(e) => {
                setFeedback(e.target.value);
                setDirty(true);
              }}
            />
          </label>
        ) : null}

        {final ? (
          <div className="final-box">
            <p
              title={`${formatDateTime(final.decidedAt)}${final.basedOnSuggestionId ? ` · 근거 제안 #${suggestions.findIndex((s) => s.suggestionId === final.basedOnSuggestionId) + 1}` : ""}`}
            >
              <span className="badge badge-ok">확정</span> {item.rubric.reduce((s, c) => s + (final.levels[c.id] ?? 0), 0)} / {item.maxScore} · {SOURCE_TEXT[final.source]}
            </p>
            <div className="btn-row">
              {props.next ? (
                <button type="button" className="btn btn-primary" ref={nextRef} onClick={props.next.go}>
                  다음 답안 → {props.next.label}
                </button>
              ) : (
                <span className="small text-ok">모든 답안을 확정했습니다.</span>
              )}
              <button type="button" className="btn btn-outline" onClick={() => props.onAction({ type: "reopen", key: props.recordKey })}>
                다시 열기
              </button>
            </div>
          </div>
        ) : (
          <div className="gw-actions">
            {mode === "view" && canAccept(usable) ? (
              <>
                <button type="button" className="btn btn-primary" onClick={() => finalize(acceptLevels(usable), "review")}>
                  AI 제안 수락 ({usable.result.total}점)
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setMode("edit");
                    setActionError(null);
                  }}
                >
                  수정
                </button>
                <button type="button" className="btn btn-link" onClick={startManual}>
                  직접 채점
                </button>
              </>
            ) : editing ? (
              <>
                <button type="button" className="btn btn-primary" disabled={!complete || pendingSource === null} onClick={() => finalize(levels as CriterionLevels, decisionMode)}>
                  {pendingSource ? ACTION_TEXT[pendingSource] : "모든 기준을 고르세요"}
                </button>
                {mode === "edit" && usable ? (
                  <button type="button" className="btn btn-link" onClick={startManual}>
                    직접 채점으로
                  </button>
                ) : null}
                <button type="button" className="btn btn-link" onClick={() => load(viewId)}>
                  {usable ? "제안으로 되돌리기" : "취소"}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-outline" onClick={startManual}>
                직접 채점
              </button>
            )}
            {pendingSource === "edited" && editing && usable?.result.status === "valid" ? <span className="small muted">AI 제안과 다른 수준을 골랐습니다.</span> : null}
          </div>
        )}
        {actionError ? (
          <p className="text-danger small" role="alert">
            {actionError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
