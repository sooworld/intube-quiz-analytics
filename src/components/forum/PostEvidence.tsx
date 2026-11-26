"use client";
// 글별 근거 프로필 (bc-methodology.md T5, b0-prereg.md §5·§7 S6).
// 근거 후보 구간의 기록이다. 수준 점수·종합 점수·순위·완성률을 만들지 않는다.
// 교수가 먼저 배정할 수 있다(분석 전에도). 확정 칸의 기본값은 도구 제안이 아니라 "선택 안 함"이다(Codex 구현 검토 7).
// 도구 제안은 그대로 두고, 교수 확정은 따로 저장하며 바꾼 이력을 남긴다. 검토 필요(S6) 글은 자동 설명 전체를 접는다(검토 1).
import Link from "next/link";
import { useEffect, useState } from "react";
import { AiRunStatus } from "@/components/ai/AiRunStatus";
import { InfoTip } from "@/components/moodle/InfoTip";
import { CaveatNote } from "@/components/moodle/PageParts";
import { forumProfileTask, mergeProfileResults, splitProfileInput, type ForumProfileInput, RUBRIC_STATE_LABEL, type ValidatedPostProfile } from "@/lib/ai/tasks/forumProfile";

import { useDraftRun } from "@/lib/ai/useDraftRun";
import { decide, MAX_SECONDARY, type AssignmentValue } from "@/lib/forum/state";
import { RESPONSE_FUNCTION_LABEL, SPECIAL_TARGET_LABEL, type AssignmentTarget, type ForumDataset, type ForumPost } from "@/lib/forum/types";
import { formatDateTime } from "@/lib/format";
import { useForum } from "@/lib/state/ForumContext";
import { Highlighted, qText, targetLabel, ToolLabel } from "./parts";
import { useDiscussion } from "./useDiscussion";

const PROFILE_SPLIT = { split: (i: ForumProfileInput) => splitProfileInput(i), merge: mergeProfileResults };

type Filter = "all" | "review" | "decided" | "undecided" | AssignmentTarget;

function valueOf(p: ValidatedPostProfile | undefined): AssignmentValue | null {
  return p ? { primary: p.primary, secondary: p.secondary } : null;
}

function show(v: AssignmentValue | null): string {
  if (!v) return "없음";
  return `${targetLabel(v.primary)}${v.secondary.length ? ` (+${v.secondary.join(", ")})` : ""}`;
}

export function PostEvidence() {
  const d = useDiscussion();
  const { ds, ready, profile, finals, hints, overlaps } = d;
  // 실제 모델은 글을 PROFILE_BATCH개씩 나눠 부른다(2026-11-26 LG 실연에서 한 번에 18개는 시간 초과)
  const run = useDraftRun(forumProfileTask, { quizId: ds.forum.id, dataVersion: ds.dataVersion, addDraft: d.addDraft }, PROFILE_SPLIT);
  const [filter, setFilter] = useState<Filter>("all");
  // 교수 먼저(F3): 기본은 내 배정 전에는 도구 제안을 숨긴다. 글마다 "도구 제안 보기"로 열 수 있다 (B3a 사전 점검)
  const [hideFirst, setHideFirst] = useState(true);
  const lastFailed = d.latestProfileAttempt && d.latestProfileAttempt.result.status === "invalid" && d.latestProfileAttempt.draftId !== profile?.draftId ? d.latestProfileAttempt : null;

  // 논의 지도의 "#filter=new" 링크로 들어오면 그 묶음을 연다. 해시는 브라우저에만 있어 마운트 후에 읽는다
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const m = /filter=([\w-]+)/.exec(window.location.hash);
    if (m) setFilter(m[1] as Filter);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const byPost = new Map((profile?.result.posts ?? []).map((p) => [p.postId, p]));
  const finalOf = new Map(finals.map((f) => [f.postId, f]));
  const visible = ds.posts.filter((p) => {
    if (filter === "all") return true;
    const f = finalOf.get(p.id);
    if (filter === "review") return (byPost.get(p.id)?.issues.length ?? 0) > 0;
    if (filter === "decided") return f?.source === "teacher";
    if (filter === "undecided") return f?.source !== "teacher";
    return f?.primary === filter || (f?.secondary ?? []).includes(filter);
  });
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "전체" },
    { id: "undecided", label: "미확정" },
    { id: "decided", label: "교수 확정" },
    ...ds.subQuestions.map((q) => ({ id: q.id as Filter, label: q.id })),
    { id: "new", label: SPECIAL_TARGET_LABEL.new },
    { id: "off", label: SPECIAL_TARGET_LABEL.off },
    { id: "hold", label: SPECIAL_TARGET_LABEL.hold },
    { id: "review", label: "검토 필요" },
  ];

  return (
    <div className="stack">
      {d.sessionOnly || run.unsaved ? <CaveatNote>브라우저 저장소를 쓸 수 없어 이번 세션에만 반영됩니다. 새로고침하면 확정 기록이 사라집니다.</CaveatNote> : null}
      <section className="card" aria-labelledby="pe-head">
        <h2 className="card-title" id="pe-head">
          글별 근거
          <InfoTip label="글별 근거">
            <span>
              분석 전에도 글마다 직접 배정할 수 있습니다. 분석을 실행하면 도구가 하위 논점 배정, 답글 기능, 루브릭 기준별 근거 후보 문장을 붙입니다. <strong>구간 확인</strong>은 그 기준과 관련된 문장이 있다는 뜻일 뿐, 기준을 충족했다는 뜻이 아닙니다. 점수와 순위는 만들지 않습니다.
            </span>
          </InfoTip>
        </h2>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => void run.run(d.input, d.basis)} disabled={run.busy || !ready}>
            {profile ? "분석 다시 실행" : "분석 실행"}
          </button>
          <span className="small muted">{run.modelLabel}</span>
          {profile ? <ToolLabel provider={profile.provider} model={profile.responseModel} /> : null}
          <Link className="small" href={`/forum/${ds.forum.id}/map/`}>논의 지도로</Link>
        </div>
        {run.busy && run.progress ? <p className="small" style={{ margin: 0 }}>글 묶음 {run.progress.done + 1}/{run.progress.total} 분석 중</p> : null}
        <AiRunStatus busy={run.busy} wait={run.wait} error={run.error} retryable={run.retryable} idleMessage={profile ? null : "분석 전에는 원문과 내 배정만 보입니다."} onRetry={() => void run.run(d.input, d.basis)} />
        {lastFailed ? (
          <CaveatNote>
            마지막 실행({formatDateTime(lastFailed.createdAt)})은 형식 오류라 쓰지 않았습니다{profile ? ` · 아래는 ${formatDateTime(profile.createdAt)} 결과입니다` : ""}.
          </CaveatNote>
        ) : null}
        {d.staleProfile ? <CaveatNote>글이나 과제가 바뀌어 이전 분석은 쓰지 않습니다. 다시 실행하세요.</CaveatNote> : null}
        <label className="small" style={{ display: "block", margin: "0.25rem 0 0.5rem" }}>
          <input type="checkbox" checked={hideFirst} onChange={(e) => setHideFirst(e.target.checked)} /> 내 배정 전에는 도구 제안 숨기기
          <InfoTip label="도구 제안 숨기기">
            <span>도구 결과를 먼저 보면 판단이 끌려갑니다. 켜 두면 글마다 내 배정을 확정하거나 ‘도구 제안 보기’를 누른 뒤에만 도구 결과와 강조가 보입니다. 확정할 때 도구 제안을 봤는지도 기록합니다.</span>
          </InfoTip>
        </label>
        <div className="pe-filters" role="group" aria-label="글 거르기">
          {filters.map((f) => (
            <button key={f.id} type="button" className="btn btn-sm btn-outline" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {visible.length === 0 ? <p className="small">이 묶음에 해당하는 글이 없습니다.</p> : null}
      {visible.map((p) => (
        <PostCard
          key={`${p.id}:${d.assignments.decisions[p.id]?.decidedAt ?? "-"}`}
          post={p}
          prof={byPost.get(p.id)}
          draftId={profile?.draftId ?? null}
          provider={profile?.provider ?? null}
          lexical={profile ? (hints[p.id]?.candidates ?? []) : []}
          overlapWith={profile ? overlaps.filter((o) => o.a === p.id || o.b === p.id).map((o) => (o.a === p.id ? o.b : o.a)) : []}
          hideFirst={hideFirst}
        />
      ))}
    </div>
  );
}

function PostCard({
  post,
  prof,
  draftId,
  provider,
  lexical,
  overlapWith,
  hideFirst,
}: {
  hideFirst: boolean;
  post: ForumPost;
  prof: ValidatedPostProfile | undefined;
  draftId: string | null;
  provider: string | null;
  lexical: { qId: string; cosine: number }[];
  overlapWith: string[];
}) {
  const d = useForum();
  const { ds } = d;
  const decision = d.assignments.decisions[post.id] ?? null;
  const review = (prof?.issues.length ?? 0) > 0;
  const proposal = review ? null : valueOf(prof);
  const [primary, setPrimary] = useState<AssignmentTarget | "">(decision?.primary ?? "");
  const [secondary, setSecondary] = useState<string[]>(decision?.secondary ?? []);
  const [focusCrit, setFocusCrit] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const toolVisible = !!prof && (!hideFirst || !!decision || revealed);
  const parent = post.parentId ? ds.posts.find((x) => x.id === post.parentId) : null;
  const top2 = lexical.slice(0, 2).map((c) => c.qId);
  const outsideTop2 = !!prof && prof.primary.startsWith("Q") && lexical.length > 0 && !top2.includes(prof.primary);
  const history = d.assignments.log.filter((e) => e.postId === post.id);
  const isQ = primary.startsWith("Q");

  const spans: { span: [number, number]; cls: string; label: string }[] = [];
  if (prof?.primarySpan && !review && toolVisible) spans.push({ span: prof.primarySpan, cls: "hl-0", label: "배정 근거" });
  const fc = prof?.rubric.find((r) => r.criterionId === focusCrit);
  if (fc?.span && !review && toolVisible) spans.push({ span: fc.span, cls: "hl-1", label: ds.rubric.find((c) => c.id === fc.criterionId)?.name ?? "" });

  const save = (v: AssignmentValue | null) => d.updateAssignments((s) => decide(s, post.id, v, valueOf(prof), draftId, new Date().toISOString(), prof ? toolVisible : undefined));

  const auto = prof ? (
    <div className="pe-grid">
      <div>
        <h3>도구 제안</h3>
        <Proposal prof={prof} provider={provider} ds={ds} />
        {lexical.length > 0 ? (
          <p className="pe-quote" style={{ marginTop: "0.375rem" }}>
            어휘 후보: {lexical.slice(0, 2).map((c) => `${c.qId} ${c.cosine.toFixed(2)}`).join(" · ")} <span className="muted">(글자 조각 겹침, 배정 아님)</span>
            {outsideTop2 ? <span className="badge" style={{ marginLeft: "0.25rem" }}>제안이 어휘 후보 밖</span> : null}
          </p>
        ) : null}
        {prof.notInWork.length > 0 ? <p className="pe-quote">작품에서 그대로 찾지 못한 인용: {prof.notInWork.map((q) => `“${q}”`).join(", ")} <span className="muted">(바꿔 쓴 말·다른 작품일 수 있음)</span></p> : null}
        {prof.notes.length > 0 ? <p className="pe-quote">규칙: {prof.notes.join(" · ")}</p> : null}
      </div>
      <div>
        <h3>답글 기능</h3>
        <p className="small" style={{ margin: 0 }}>
          {RESPONSE_FUNCTION_LABEL[prof.function]}
          {prof.respondsTo ? ` → ${prof.respondsTo}` : ""}
        </p>
      </div>
      <div>
        <h3>
          루브릭 근거 후보
          <InfoTip label="루브릭 근거 후보">
            <span>문장을 누르면 글에서 그 구간을 강조합니다. 구간이 있다는 것과 그 구간이 기준에 맞는다는 것은 다릅니다.</span>
          </InfoTip>
        </h3>
        <ul className="pe-rubric">
          {prof.rubric.map((r) => {
            const c = ds.rubric.find((x) => x.id === r.criterionId);
            return (
              <li key={r.criterionId}>
                <span title={c?.description}>{c?.name}</span>
                <span>
                  <span className="small">{RUBRIC_STATE_LABEL[r.state]}</span>
                  {r.quote ? (
                    <span className="pe-quote">
                      {" "}
                      <button type="button" aria-pressed={focusCrit === r.criterionId} onClick={() => setFocusCrit(focusCrit === r.criterionId ? null : r.criterionId)}>
                        “{r.quote}”
                      </button>
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  ) : null;

  return (
    <article className="card pe-card" id={`post-${post.id}`} aria-labelledby={`pe-${post.id}`}>
      <div className="fp-head">
        <span className="avatar" aria-hidden="true">{post.author.slice(0, 1)}</span>
        <strong id={`pe-${post.id}`}>{post.author}</strong>
        <span>{post.id} · {formatDateTime(post.createdAt)}</span>
        {parent ? <span>· {parent.author}({parent.id})에게 답글</span> : null}
        {toolVisible && prof?.flags.includes("injection-suspected") ? <span className="badge badge-danger">글 속 지시문 의심</span> : null}
        {toolVisible && prof?.flags.includes("not-in-work") ? <span className="badge badge-warn">작품에서 그대로 찾지 못한 인용</span> : null}
        {toolVisible && overlapWith.length > 0 ? <span className="badge badge-warn">표현 중복 후보(어휘 기준): {overlapWith.join(", ")}</span> : null}
        {decision ? <span className="badge badge-ok">교수 확정: {show(decision)}{decision.sawProposal === false ? " · 제안 보기 전" : ""}</span> : null}
      </div>
      <div className="fp-body">
        <Highlighted text={post.text} spans={spans} />
      </div>

      <div className="pe-grid">
        <div>
          <h3>내 배정</h3>
          <div className="pe-decide">
            <label className="small">
              주 배정{" "}
              <select
                value={primary}
                onChange={(e) => {
                  const v = e.target.value as AssignmentTarget | "";
                  setPrimary(v);
                  if (!v.startsWith("Q")) setSecondary([]);
                  else setSecondary((s) => s.filter((q) => q !== v));
                }}
              >
                <option value="">선택 안 함</option>
                {ds.subQuestions.map((q) => (
                  <option key={q.id} value={q.id}>{q.id}</option>
                ))}
                {(["new", "off", "hold"] as const).map((t) => (
                  <option key={t} value={t}>{SPECIAL_TARGET_LABEL[t]}</option>
                ))}
              </select>
            </label>
            {isQ ? (
              <span className="pe-secondary" role="group" aria-label={`부 배정 (최대 ${MAX_SECONDARY}개)`}>
                {ds.subQuestions
                  .filter((q) => q.id !== primary)
                  .map((q) => (
                    <label key={q.id}>
                      <input
                        type="checkbox"
                        checked={secondary.includes(q.id)}
                        disabled={!secondary.includes(q.id) && secondary.length >= MAX_SECONDARY}
                        onChange={(e) => setSecondary((s) => (e.target.checked ? [...s, q.id] : s.filter((x) => x !== q.id)))}
                      />{" "}
                      부 {q.id}
                    </label>
                  ))}
              </span>
            ) : null}
          </div>
          <div className="btn-row" style={{ marginTop: "0.5rem" }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={!d.ready || primary === ""} onClick={() => primary !== "" && save({ primary, secondary })}>
              확정
            </button>
            {proposal && !decision && toolVisible ? (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => {
                  setPrimary(proposal.primary);
                  setSecondary(proposal.secondary);
                }}
              >
                도구 제안을 칸에 넣기
              </button>
            ) : null}
            {decision ? (
              <button type="button" className="btn btn-sm btn-link" onClick={() => save(null)}>
                확정 취소
              </button>
            ) : null}
          </div>
          {history.length > 0 ? (
            <details>
              <summary className="small">바꾼 이력 {history.length}건</summary>
              <ul className="small" style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                {history.map((h, i) => (
                  <li key={i}>
                    {formatDateTime(h.at)} · {show(h.from)} → {h.to ? show(h.to) : "확정 취소"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>

      {prof && !toolVisible ? (
        <p className="small" style={{ margin: "0.75rem 0 0" }}>
          <button type="button" className="btn btn-sm btn-link" onClick={() => setRevealed(true)}>
            이 글의 도구 제안 보기
          </button>
          <span className="muted"> 내 배정을 먼저 정하면 판단이 끌려가지 않습니다.</span>
        </p>
      ) : prof && review ? (
        <div className="alert alert-warning" style={{ margin: "0.75rem 0 0" }}>
          <p className="small" style={{ margin: 0 }}>
            <strong>검토 필요</strong>: {prof.issues.join(" · ")}. 도구 설명을 모두 접고, 교수가 확정하기 전까지 판단 보류로 셉니다.
          </p>
          <details>
            <summary className="small">접힌 도구 결과 보기</summary>
            {auto}
          </details>
        </div>
      ) : (
        auto
      )}
    </article>
  );
}

function Proposal({ prof, provider, ds }: { prof: ValidatedPostProfile; provider: string | null; ds: ForumDataset }) {
  return (
    <>
      <p className="small" style={{ margin: 0 }}>
        {provider ? <ToolLabel provider={provider} model={null} /> : null} <strong title={prof.primary.startsWith("Q") ? qText(ds, prof.primary) : undefined}>{targetLabel(prof.primary)}</strong>
        {prof.primary === "new" ? " (교수 확인 전)" : ""}
      </p>
      {prof.primaryQuote ? <p className="pe-quote">근거: “{prof.primaryQuote}”</p> : null}
      {prof.secondaryQuotes.map((s) => (
        <p key={s.qId} className="pe-quote">
          부 {s.qId}: “{s.quote}”
        </p>
      ))}
      {prof.newPoint ? (
        <ul className="pe-quote" style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
          <li>주제와 이어짐: “{prof.newPoint.topicLink}”</li>
          {prof.newPoint.contrasts.map((c) => (
            <li key={c.qId}>{c.qId} 대조: {c.reason}</li>
          ))}
          <li>새 논점 서술: “{prof.newPoint.statement}”</li>
        </ul>
      ) : null}
    </>
  );
}
