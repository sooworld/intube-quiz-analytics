"use client";
// 결과 분석 요약 초안 카드 (docs/decisions.md §8.3–8.4). 숫자는 코드가 만든 사실 절로만 나온다.
// AI 문장 → 교수 편집(다시 검사) → 확정 저장. 원본 초안은 바뀌지 않는다.
import { useMemo, useState } from "react";
import { modelLabel } from "@/lib/ai/capabilities";
import { AiRunStatus } from "@/components/ai/AiRunStatus";
import { InfoTip } from "@/components/moodle/InfoTip";
import { CaveatNote } from "@/components/moodle/PageParts";
import {
  analysisSummaryBasis,
  analysisSummaryTask,
  checkSentence,
  renderPlain,
  renderSegments,
  SUGGESTION_HEADING,
  withStatus,
  type AnalysisSummaryInput,
  type AnalysisSummaryResult,
  type SummaryHeading,
  type SummarySection,
} from "@/lib/ai/tasks/analysisSummary";
import { useDraftRun } from "@/lib/ai/useDraftRun";
import { buildAnalysisFacts, type Fact } from "@/lib/analysis/facts";
import { formatDateTime } from "@/lib/format";
import type { AiDraft, SummaryFinal } from "@/lib/state/aiRecords";
import { useQuiz } from "@/lib/state/QuizContext";

const STATUS_TEXT = { valid: "검사 통과", "needs-review": "검토 필요", invalid: "사용 불가(형식 오류)" } as const;
const ISSUE_TEXT = { "number-outside-token": "토큰 밖 숫자", "no-fact": "근거 사실 없음", "forbidden-term": "쓰지 않기로 한 표현" } as const;

/** 사실 칩: 문장 안에 인라인으로 두고, 누르면 근거를 펼친다(초점은 버튼에 그대로 남는다) */
function FactChip({ fact }: { fact: Fact }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fact-chip" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="근거 보기">
        {fact.text}
      </button>
      {open ? (
        <span className="fact-chip-body">
          근거 {fact.id} · 코드가 계산한 값{fact.denominator !== null ? ` (분자 ${fact.numerator} / 분모 ${fact.denominator})` : ""}
        </span>
      ) : null}
    </>
  );
}

function Sentence({ text, facts }: { text: string; facts: Fact[] }) {
  return (
    <>
      {renderSegments(text, facts).map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i}>{seg.value}</span>
        ) : seg.kind === "fact" ? (
          <FactChip key={i} fact={seg.fact} />
        ) : (
          <span key={i} className="badge badge-danger">
            없는 사실 {seg.id}
          </span>
        ),
      )}
    </>
  );
}

function plainText(sections: { heading: string; sentences: string[] }[], facts: Fact[]): string {
  return sections.map((s) => [`[${s.heading}]`, ...s.sentences.map((t) => `- ${renderPlain(t, facts)}`)].join("\n")).join("\n\n");
}

/** 객관식 퀴즈 분석 화면용: 응답 행렬·태그·확정 관계·저장 그룹안에서 사실을 만든다 */
export function SummaryDraftCard() {
  const { ds, m, concepts, qmatrix, relations, decision, decisionStale, drafts, addDraft, summaryFinal, saveSummaryFinal, clearSummaryFinal } = useQuiz();
  const facts = useMemo(
    () => buildAnalysisFacts(m, qmatrix, concepts, relations, decision && !decisionStale ? decision : null),
    [m, qmatrix, concepts, relations, decision, decisionStale],
  );
  return (
    <SummaryDraftPanel
      quizId={ds.quiz.id}
      dataVersion={ds.dataVersion}
      facts={facts}
      factsLabel="코드 계산, 기준 50% 계산 그룹"
      drafts={drafts}
      addDraft={addDraft}
      summaryFinal={summaryFinal}
      saveSummaryFinal={saveSummaryFinal}
      clearSummaryFinal={clearSummaryFinal}
    />
  );
}

export interface SummaryPanelProps {
  quizId: string;
  dataVersion: string;
  /** 코드가 계산한 사실 목록 (AI에 보내는 전부) */
  facts: Fact[];
  /** 사실 목록 접힘 제목에 붙는 설명 */
  factsLabel: string;
  drafts: AiDraft[];
  addDraft: (d: AiDraft) => boolean;
  summaryFinal: SummaryFinal | null;
  saveSummaryFinal: (f: SummaryFinal) => boolean;
  clearSummaryFinal: () => void;
  /** 실행하면 안 되는 이유가 있으면 버튼을 막고 보여 준다 */
  blockedReason?: string | null;
}

/** 요약 초안 패널 (객관식·서술형 공통). 사실 → AI 문장 → 교수 편집·확정 */
export function SummaryDraftPanel({ quizId, dataVersion, facts, factsLabel, drafts, addDraft, summaryFinal, saveSummaryFinal, clearSummaryFinal, blockedReason }: SummaryPanelProps) {
  const runner = useDraftRun(analysisSummaryTask, { quizId, dataVersion, addDraft });
  const basis = useMemo(() => analysisSummaryBasis(dataVersion, facts), [dataVersion, facts]);
  const sumDrafts = drafts.filter((d) => d.task === "analysis-summary") as unknown as AiDraft<AnalysisSummaryInput, AnalysisSummaryResult>[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ draftId: string; sections: SummarySection[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const draft = sumDrafts.find((d) => d.draftId === selectedId) ?? sumDrafts.at(-1) ?? null;
  const draftFacts = draft?.input.facts ?? facts;
  const stale = !!draft && draft.basisHash !== basis;
  const editing = !!edit && !!draft && edit.draftId === draft.draftId;
  const view: AnalysisSummaryResult | null = draft ? (editing ? withStatus(edit.sections) : draft.result) : null;
  const finalStale = !!summaryFinal && summaryFinal.basisHash !== basis;

  const request = async () => {
    setMessage(null);
    setEdit(null);
    const d = await runner.run({ facts }, basis);
    if (d) {
      setSelectedId(d.draftId);
      setMessage(`요약 초안을 받았습니다: ${STATUS_TEXT[d.result.status]}.`);
    }
  };

  const ids = new Set(draftFacts.map((f) => f.id));
  const updateSentence = (si: number, ti: number, text: string | null) => {
    if (!edit) return;
    const sections = edit.sections.map((s, i) => {
      if (i !== si) return s;
      const sentences = text === null ? s.sentences.filter((_, k) => k !== ti) : s.sentences.map((x, k) => (k === ti ? checkSentence(text, s.heading as SummaryHeading, ids).sentence : x));
      return { ...s, sentences };
    });
    setEdit({ ...edit, sections });
  };

  const confirmSave = () => {
    if (!draft || !view) return;
    const ok = saveSummaryFinal({
      dataVersion,
      basedOnDraftId: draft.draftId,
      basisHash: draft.basisHash,
      sections: view.sections.map((s) => ({ heading: s.heading, sentences: s.sentences.map((x) => x.text) })),
      savedAt: new Date().toISOString(),
    });
    setEdit(null);
    setMessage(ok ? "요약을 확정해 이 브라우저에 저장했습니다. 원본 초안은 그대로 남아 있습니다." : "브라우저 저장소에 쓰지 못했습니다. 이번 세션에만 반영됩니다.");
  };

  const copy = async (sections: { heading: string; sentences: string[] }[], label: string, withFacts: Fact[]) => {
    try {
      await navigator.clipboard.writeText(`${plainText(sections, withFacts)}\n\n(${label} · LearnLens 가상 데이터)`);
      setMessage(`${label}을 복사했습니다.`);
    } catch {
      setMessage("클립보드에 복사하지 못했습니다(브라우저 권한 확인).");
    }
  };

  const canConfirm = !!view && !stale && !runner.unsaved && view.status === "valid";

  return (
    <section className="card" aria-labelledby="sum-title">
      <h2 className="card-title" id="sum-title">
        AI 요약 초안 <span className="badge badge-info">초안</span>
        <InfoTip label="AI 요약 초안">
          <span>
            수치는 코드가 계산했습니다. AI는 아래 사실 목록에서 사실을 고르고 문장을 이었습니다. 학생 이름은 보내지 않고, 인원·비율 같은 집계 사실만 <strong>{runner.modelLabel}</strong>(으)로 보냅니다.
          </span>
        </InfoTip>
      </h2>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={request} disabled={runner.busy || !!blockedReason}>
          {runner.busy ? "요약 받는 중…" : sumDrafts.length > 0 ? "새 요약 초안 받기" : "요약 초안 받기"}
        </button>
        {runner.busy ? (
          <button type="button" className="btn btn-outline" onClick={runner.cancel}>
            취소
          </button>
        ) : null}
        {sumDrafts.length > 1 ? (
          <label className="small">
            이전 초안{" "}
            <select
              value={draft?.draftId ?? ""}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setEdit(null);
              }}
            >
              {[...sumDrafts].reverse().map((d) => (
                <option key={d.draftId} value={d.draftId}>
                  {formatDateTime(d.createdAt)} · {modelLabel(d.provider, d.requestedModel)} · {STATUS_TEXT[d.result.status]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {blockedReason ? <p className="small muted">{blockedReason}</p> : null}
      <AiRunStatus runInfo={runner.runInfo} busy={runner.busy} wait={runner.wait} error={runner.error} retryable={runner.retryable} idleMessage={message} onRetry={request} />
      {runner.unsaved ? (
        <div className="alert alert-warning" role="alert">
          <p>초안을 브라우저에 저장하지 못해 확정할 수 없습니다. 저장 공간을 확인한 뒤 다시 받으세요.</p>
        </div>
      ) : null}

      {summaryFinal ? (
        <div className="alert alert-info">
          <p>
            <strong>확정본</strong> ({formatDateTime(summaryFinal.savedAt)} 저장){finalStale ? " · 저장 이후 응시·태그·관계·그룹안이 바뀌어 지금 수치와 다를 수 있습니다." : ""}
          </p>
          {summaryFinal.sections.map((s) => (
            <div key={s.heading}>
              <strong className="small">
                {s.heading}
                {s.heading === SUGGESTION_HEADING ? " (교수 검토용 제안)" : ""}
              </strong>
              <ul className="small">
                {s.sentences.map((t, i) => (
                  <li key={i}>
                    <Sentence text={t} facts={sumDrafts.find((d) => d.draftId === summaryFinal.basedOnDraftId)?.input.facts ?? facts} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="btn-row">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => copy(summaryFinal.sections, "확정본", sumDrafts.find((d) => d.draftId === summaryFinal.basedOnDraftId)?.input.facts ?? facts)}>
              확정본 복사
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => { clearSummaryFinal(); setMessage("확정본을 삭제했습니다."); }}>
              확정본 삭제
            </button>
          </div>
        </div>
      ) : null}

      {draft && view ? (
        <>
          <p
            className="small"
            title={`요청 모델 ${modelLabel(draft.provider, draft.requestedModel)}${draft.responseModel && modelLabel(draft.provider, draft.responseModel) !== modelLabel(draft.provider, draft.requestedModel) ? ` (응답 모델 ${modelLabel(draft.provider, draft.responseModel)})` : ""}`}
          >
            <span className={`badge ${view.status === "valid" ? "badge-ok" : view.status === "invalid" ? "badge-danger" : "badge-demo"}`}>{STATUS_TEXT[view.status]}</span>{" "}
            {formatDateTime(draft.createdAt)}
            {editing ? " · 교수 편집 중" : ""}
          </p>
          {stale ? <CaveatNote>이 초안은 지금과 다른 입력(응시·태그·관계·그룹안)으로 만든 것입니다. 사실 칩은 당시 값이며, 확정하려면 새 초안을 받으세요.</CaveatNote> : null}
          {view.problems.length > 0 ? (
            <ul className="small">
              {view.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {view.sections.map((s, si) => (
            <div key={s.heading} style={{ marginBottom: "0.75rem" }}>
              <h3 style={{ fontSize: "var(--fs-lg)", marginBottom: "0.25rem" }}>
                {s.heading} {s.heading === SUGGESTION_HEADING ? <span className="badge">교수 검토용 제안</span> : null}
              </h3>
              <ul style={{ paddingLeft: "1.25rem" }}>
                {s.sentences.map((x, ti) => (
                  <li key={`${si}-${ti}`} style={{ marginBottom: "0.25rem" }}>
                    {editing ? (
                      <div className="inline-form">
                        <label className="field grow">
                          <span className="visually-hidden">{s.heading} 문장 {ti + 1}</span>
                          <textarea rows={2} value={x.text} onChange={(e) => updateSentence(si, ti, e.target.value)} />
                        </label>
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => updateSentence(si, ti, null)} aria-label={`${s.heading} 문장 ${ti + 1} 빼기`}>
                          빼기
                        </button>
                      </div>
                    ) : null}
                    <Sentence text={x.text} facts={draftFacts} />
                    {x.issues.map((issue) => (
                      <span key={issue} className="badge badge-demo" style={{ marginLeft: 4 }}>
                        {ISSUE_TEXT[issue]}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="btn-row">
            {editing ? (
              <button type="button" className="btn btn-outline" onClick={() => setEdit(null)}>
                편집 취소
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" disabled={draft.result.status === "invalid"} onClick={() => setEdit({ draftId: draft.draftId, sections: structuredClone(draft.result.sections) })}>
                문장 편집
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={!canConfirm} onClick={confirmSave} title={view.status !== "valid" ? "검토 표시가 붙은 문장을 고치거나 빼야 확정할 수 있습니다" : undefined}>
              이 요약 확정 저장
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={draft.result.status === "invalid"}
              onClick={() => copy(view.sections.map((s) => ({ heading: s.heading, sentences: s.sentences.map((x) => x.text) })), "초안(미확정)", draftFacts)}
            >
              초안 복사
            </button>
          </div>
          {view.status === "needs-review" ? <p className="small muted">검토 표시가 붙은 문장을 고치거나 빼면 확정할 수 있습니다. 의미가 맞는지는 교수가 판단합니다.</p> : null}
        </>
      ) : null}

      <details style={{ marginTop: "0.75rem" }}>
        <summary className="small">보내는 사실 목록 {facts.length}개 ({factsLabel})</summary>
        <ol className="small">
          {facts.map((f) => (
            <li key={f.id}>
              <code>{f.id}</code> {f.text}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
