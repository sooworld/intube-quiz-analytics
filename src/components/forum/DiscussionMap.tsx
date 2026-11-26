"use client";
// 논의 지도 (bc-methodology.md T4·T7·T8, b0-prereg.md §0·§5·§7).
// 버튼을 누른 뒤에만 분석한다. 집중·공백·확장을 글 수와 작성자 수로 함께 보이고, 주 배정과 부 배정 포함 수를 나란히 둔다.
// "공백" 대신 "확인된 글 0건 (현재 배정 기준)"으로 쓴다. 예정 비중은 교수 메모이며 글 수의 기대 비율이 아니다.
import Link from "next/link";
import { useMemo, useState } from "react";
import { AiRunStatus } from "@/components/ai/AiRunStatus";
import { InfoTip } from "@/components/moodle/InfoTip";
import { CaveatNote } from "@/components/moodle/PageParts";
import { COMMENT_FIELD_LABEL, COMMENT_FIELDS, forumCommentBasis, forumCommentTask, type ForumCommentInput } from "@/lib/ai/tasks/forumComment";
import { forumProfileTask, mergeProfileResults, splitProfileInput, type ForumProfileInput } from "@/lib/ai/tasks/forumProfile";

import { useDraftRun } from "@/lib/ai/useDraftRun";
import { RESPONSE_FUNCTION_LABEL, RESPONSE_FUNCTIONS, SPECIAL_TARGET_LABEL } from "@/lib/forum/types";
import { formatDateTime } from "@/lib/format";
import { FactText, factPlain, GuessMark, qText, ToolLabel } from "./parts";
import { useDiscussion } from "./useDiscussion";

const PROFILE_SPLIT = { split: (i: ForumProfileInput) => splitProfileInput(i), merge: mergeProfileResults };

export function DiscussionMap() {
  const d = useDiscussion();
  const { ds, ready, profile, agg, mix, facts, overlaps } = d;
  // 실제 모델은 글을 PROFILE_BATCH개씩 나눠 부른다(2026-11-26 LG 실연에서 한 번에 18개는 시간 초과)
  const run = useDraftRun(forumProfileTask, { quizId: ds.forum.id, dataVersion: ds.dataVersion, addDraft: d.addDraft }, PROFILE_SPLIT);
  const cRun = useDraftRun(forumCommentTask, { quizId: ds.forum.id, dataVersion: ds.dataVersion, addDraft: d.addDraft });
  const cInput: ForumCommentInput = useMemo(() => ({ forumId: ds.forum.id, facts }), [ds.forum.id, facts]);
  const cBasis = useMemo(() => forumCommentBasis(cInput), [cInput]);
  const comment = d.latestComment && d.latestComment.basisHash === cBasis ? d.latestComment : null;
  const [copied, setCopied] = useState<string | null>(null);
  const [most, setMost] = useState<string>("");
  const [least, setLeast] = useState<string>("");

  const exp = d.expectation;
  const byAny = [...agg.questions].sort((a, b) => b.anyPosts - a.anyPosts);
  const byPrimary = [...agg.questions].sort((a, b) => b.primaryPosts - a.primaryPosts);
  const name = (pid: string) => ds.posts.find((p) => p.id === pid)?.author ?? pid;
  const textOf = (pid: string) => ds.posts.find((p) => p.id === pid)?.text ?? "";
  // 검토 필요 글(S6)은 기능 집계에서 뺀다 (Codex 구현 검토 1)
  const fnCounts = RESPONSE_FUNCTIONS.map((f) => ({
    f,
    n: profile?.result.posts.filter((p) => p.issues.length === 0 && p.function === f && ds.posts.find((x) => x.id === p.postId)?.parentId !== null).length ?? 0,
  })).filter((x) => x.n > 0);
  const lastFailed = d.latestProfileAttempt && d.latestProfileAttempt.result.status === "invalid" && d.latestProfileAttempt.draftId !== profile?.draftId ? d.latestProfileAttempt : null;
  const lastFailedComment = d.latestCommentAttempt && d.latestCommentAttempt.result.status === "invalid" && d.latestCommentAttempt.draftId !== comment?.draftId ? d.latestCommentAttempt : null;
  const scale = Math.max(1, ...agg.questions.map((q) => q.anyPosts));

  const marks = comment ? (d.commentMarks.byDraft[comment.draftId] ?? {}) : {};
  const mark = (idx: number, v: "ok" | "wrong") => {
    if (!comment) return;
    const cur = d.commentMarks.byDraft[comment.draftId] ?? {};
    const next = { ...cur };
    if (next[String(idx)] === v) delete next[String(idx)];
    else next[String(idx)] = v;
    d.saveCommentMarks({ ...d.commentMarks, byDraft: { ...d.commentMarks.byDraft, [comment.draftId]: next } });
  };
  const copyComment = async () => {
    if (!comment) return;
    const tag = comment.provider === "mock" ? "규칙 기반 예시 해석 · 미검증" : `AI 추정 · 미검증 · ${comment.responseModel ?? comment.requestedModel}`;
    const body = comment.result.items
      .map((it, k) => [`${k + 1}. (${it.focus})`, ...COMMENT_FIELDS.map((f) => `- ${COMMENT_FIELD_LABEL[f]}: ${factPlain(it.fields[f], facts)}`)].join("\n"))
      .join("\n\n");
    const text = `[${ds.forum.name} 첨언 초안 · 합성 글 · ${tag}]\n[숫자가 든 구절만 코드가 계산한 사실이고, 나머지 문장은 모두 ${tag}입니다]\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied("복사했습니다.");
    } catch {
      setCopied("복사하지 못했습니다. 브라우저가 클립보드 접근을 막았습니다.");
    }
  };

  return (
    <div className="stack">
      {d.sessionOnly || run.unsaved || cRun.unsaved ? <CaveatNote>브라우저 저장소를 쓸 수 없어 이번 세션에만 반영됩니다. 새로고침하면 사라집니다.</CaveatNote> : null}
      <section className="card" aria-labelledby="dmap-exp">
        <h2 className="card-title" id="dmap-exp">
          실행 전 내 예상 (선택)
          <InfoTip label="실행 전 예상">
            <span>분석 결과를 보기 전에 예상을 적어 두면, 결과에 끌려가지 않고 비교할 수 있습니다. 적지 않아도 분석은 할 수 있습니다.</span>
          </InfoTip>
        </h2>
        {exp ? (
          <p className="small" style={{ margin: 0 }}>
            가장 많이 다뤄졌을 논점 <strong>{exp.most ?? "—"}</strong> · 거의 다뤄지지 않았을 논점 <strong>{exp.least ?? "—"}</strong>
            <span className="muted"> ({formatDateTime(exp.savedAt)})</span>{" "}
            <button type="button" className="btn btn-sm btn-link" onClick={() => d.saveExpectation(null)}>
              다시 적기
            </button>
          </p>
        ) : (
          <div className="btn-row">
            <label className="small">
              가장 많이 다뤄졌을 논점{" "}
              <select value={most} onChange={(e) => setMost(e.target.value)}>
                <option value="">선택</option>
                {ds.subQuestions.map((q) => (
                  <option key={q.id} value={q.id}>{q.id}</option>
                ))}
              </select>
            </label>
            <label className="small">
              거의 다뤄지지 않았을 논점{" "}
              <select value={least} onChange={(e) => setLeast(e.target.value)}>
                <option value="">선택</option>
                {ds.subQuestions.map((q) => (
                  <option key={q.id} value={q.id}>{q.id}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={!ready || (most === "" && least === "")}
              onClick={() => d.saveExpectation({ dataVersion: ds.dataVersion, most: most || null, least: least || null, savedAt: new Date().toISOString() })}
            >
              예상 저장
            </button>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="dmap-run">
        <h2 className="card-title" id="dmap-run">
          논의 구조
          <InfoTip label="논의 구조">
            <span>
              글마다 하위 논점에 배정합니다. <strong>주 배정</strong>은 글의 중심 주장이 답하는 논점이고, <strong>부 배정</strong>은 근거 문장이 있는 다른 논점입니다. 주 배정이 0건이라고 논의가 없었던 것은 아닙니다.
              중요도는 교수 메모입니다. 정리 시간 예정 비중은 막대와 비교할 목표치가 아니라서 여기 두지 않고 토론 탭에만 둡니다. 새 논점 후보는 주제와의 연결·모든 논점과의 대조·새 논점 서술의 세 근거가 다 있을 때만 셉니다. 검토가 필요한 글은 교수가 확정하기 전까지 판단 보류로 셉니다.
            </span>
          </InfoTip>
        </h2>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => void run.run(d.input, d.basis)} disabled={run.busy || !ready}>
            {profile ? "분석 다시 실행" : "분석 실행"}
          </button>
          <span className="small muted">{run.modelLabel}</span>
          {profile ? <ToolLabel provider={profile.provider} model={profile.responseModel} /> : null}
        </div>
        {run.busy && run.progress ? <p className="small" style={{ margin: 0 }}>글 묶음 {run.progress.done + 1}/{run.progress.total} 분석 중</p> : null}
        <AiRunStatus busy={run.busy} wait={run.wait} error={run.error} retryable={run.retryable} idleMessage={profile ? null : "버튼을 누르면 이 토론의 글만 분석합니다."} onRetry={() => void run.run(d.input, d.basis)} />
        {d.staleProfile ? <CaveatNote>글이나 과제가 바뀌어 이전 분석은 쓰지 않습니다. 다시 실행하세요.</CaveatNote> : null}
        {lastFailed ? (
          <CaveatNote>
            마지막 실행({formatDateTime(lastFailed.createdAt)})은 형식 오류라 쓰지 않았습니다{profile ? ` · 아래는 ${formatDateTime(profile.createdAt)} 결과입니다` : ""}.
          </CaveatNote>
        ) : null}

        {profile ? (
          <>
            <p className="small">
              배정 기준: 교수 확정 <strong>{mix.teacher}</strong> · 도구 제안 그대로 <strong>{mix.proposed}</strong> · 검토 필요라 보류 <strong>{mix.review}</strong> (글 {agg.totalPosts}개, 작성자 {agg.totalAuthors}명, 스레드 {agg.threads}개){" "}
              <Link href={`/forum/${ds.forum.id}/posts/`}>글별 근거에서 확정하기</Link>
            </p>
            <div className="legend" aria-hidden="true">
              <span><span className="legend-swatch" style={{ background: "var(--series-1)" }} />주 배정</span>
              <span><span className="legend-swatch" style={{ background: "var(--seq-2)" }} />부 배정 포함</span>
            </div>
            <ul className="hbar-list" aria-label="하위 논점별 글 수">
              {agg.questions.map((q) => {
                const sq = ds.subQuestions.find((x) => x.id === q.qId)!;
                return (
                  <li key={q.qId} className="hbar-row">
                    <span className="hbar-label">
                      <strong title={qText(ds, q.qId)}>{q.qId}</strong>
                      <span className="map-plan"> 중요도 {sq.importance}</span>
                    </span>
                    <div className="hbar-pair">
                      <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(q.primaryPosts / scale) * 100}%`, background: "var(--series-1)" }} /></div>
                      <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(q.anyPosts / scale) * 100}%`, background: "var(--seq-2)" }} /></div>
                    </div>
                    <span className="hbar-value">
                      {q.anyPosts === 0 ? (
                        <span className="map-zero">확인된 글 0건 (현재 배정 기준)</span>
                      ) : (
                        <>
                          주 {q.primaryPosts}개 · {q.primaryAuthors}명
                          <br />
                          부 포함 {q.anyPosts}개 · {q.anyAuthors}명
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="small" style={{ marginTop: "0.75rem" }}>
              {(["new", "off", "hold"] as const).map((t, i) => (
                <span key={t}>
                  {i > 0 ? " · " : ""}
                  <Link href={`/forum/${ds.forum.id}/posts/#filter=${t}`}>{SPECIAL_TARGET_LABEL[t]}{t === "new" ? "(교수 확인 전 포함)" : ""}</Link>{" "}
                  {agg.special[t].posts === 0 ? "현재 배정에서 0건" : `${agg.special[t].posts}개`}
                </span>
              ))}
            </p>
            {exp ? (
              <p className="small">
                내 예상과 비교: 가장 많음 {exp.most ?? "—"} → 결과(주 배정) {byPrimary[0]?.qId} {exp.most === byPrimary[0]?.qId ? "같음" : "다름"} · 가장 적음 {exp.least ?? "—"} → 결과(부 포함) {byAny[byAny.length - 1]?.qId}{" "}
                {exp.least === byAny[byAny.length - 1]?.qId ? "같음" : "다름"}
              </p>
            ) : null}
            {fnCounts.length > 0 ? (
              <p className="small">
                답글 기능 (도구 제안): {fnCounts.map((x) => `${RESPONSE_FUNCTION_LABEL[x.f]} ${x.n}`).join(" · ")}
                <InfoTip label="답글 기능">
                  <span>답글이 부모 글에 어떻게 응답하는지입니다. 토론 전체의 지식 구성 단계(스레드 단위)는 이 데모에서 다루지 않습니다.</span>
                </InfoTip>
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      {profile ? (
        <section className="card" aria-labelledby="dmap-comment">
          <h2 className="card-title" id="dmap-comment">
            첨언 초안
            <InfoTip label="첨언 초안">
              <span>
                관찰 → 해석 → 대안 → 보류 → 질문의 정해진 형식입니다. 숫자는 코드가 계산한 사실(회색 칩)로만 나옵니다. 학생을 진단하지 않고, 글 수만으로 수업 시간을 옮기자고 하지 않습니다. 교수만 보는 초안이며, 쓰기 전에 원문을 확인하세요.
              </span>
            </InfoTip>
          </h2>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => void cRun.run(cInput, cBasis)} disabled={cRun.busy || !ready}>
              {comment ? "첨언 다시 만들기" : "첨언 초안 만들기"}
            </button>
            <span className="small muted">{cRun.modelLabel}</span>
            {comment ? <ToolLabel provider={comment.provider} model={comment.responseModel} /> : null}
          </div>
          <AiRunStatus busy={cRun.busy} wait={cRun.wait} error={cRun.error} retryable={cRun.retryable} idleMessage={null} onRetry={() => void cRun.run(cInput, cBasis)} />
          {d.latestComment && !comment ? <CaveatNote>배정이 바뀌어 사실 목록이 달라졌습니다. 이전 첨언은 쓰지 않습니다. 다시 만드세요.</CaveatNote> : null}
          {lastFailedComment ? <CaveatNote>마지막 첨언 실행({formatDateTime(lastFailedComment.createdAt)})은 형식 오류라 쓰지 않았습니다. {lastFailedComment.result.problems.slice(0, 2).join(" ")}</CaveatNote> : null}
          {comment ? (
            <>
              <p className="small muted" style={{ margin: "0.5rem 0" }}>
                회색 칩만 코드가 계산한 사실입니다. 칩 밖의 문장은 모두 <GuessMark provider={comment.provider} />입니다.
              </p>
              {comment.result.status === "needs-review" ? <CaveatNote>검토 필요: {comment.result.problems.join(" ")}</CaveatNote> : null}
              {comment.result.items.map((it, k) => (
                <div key={k} className="cm-item">
                  <dl>
                    {COMMENT_FIELDS.map((f) => (
                      <div key={f} style={{ display: "contents" }}>
                        <dt>{COMMENT_FIELD_LABEL[f]}</dt>
                        <dd>
                          <FactText text={it.fields[f]} facts={facts} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="cm-actions">
                    {it.issues.length > 0 ? <span className="badge badge-danger">검토 필요</span> : null}
                    <span className="muted">이 첨언은</span>
                    <button type="button" className="btn btn-sm btn-outline" aria-pressed={marks[String(k)] === "ok"} onClick={() => mark(k, "ok")}>
                      맞음
                    </button>
                    <button type="button" className="btn btn-sm btn-outline" aria-pressed={marks[String(k)] === "wrong"} onClick={() => mark(k, "wrong")}>
                      틀림
                    </button>
                    {marks[String(k)] ? <span className="muted">표시함: {marks[String(k)] === "ok" ? "맞음" : "틀림"}</span> : null}
                  </div>
                </div>
              ))}
              <div className="btn-row" style={{ marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => void copyComment()}>
                  표지와 함께 복사
                </button>
                <span role="status" className="small muted">{copied}</span>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {/* 표현 중복도 버튼을 누른 뒤에만 보인다(분석은 버튼 뒤, p2-requirements R3) */}
      {profile ? (
      <section className="card" aria-labelledby="dmap-overlap">
        <h2 className="card-title" id="dmap-overlap">
          표현 중복 후보
          <InfoTip label="표현 중복 후보">
            <span>큰따옴표 안의 인용과 작품 구절을 지운 뒤, 두 글이 글자 조각을 많이 함께 쓰면(0.5 이상) 후보로 보입니다. 복사라고 판정하지 않습니다. 원문을 나란히 놓고 확인하세요.</span>
          </InfoTip>
        </h2>
        {overlaps.length === 0 ? (
          <p className="small">후보 없음</p>
        ) : (
          overlaps.map((p) => (
            <details key={`${p.a}-${p.b}`}>
              <summary className="small">
                {p.a} {name(p.a)} ↔ {p.b} {name(p.b)} · 표현 중복 후보 · 원문 대조 필요
              </summary>
              <div className="overlap-pair">
                <blockquote>{textOf(p.a)}</blockquote>
                <blockquote>{textOf(p.b)}</blockquote>
              </div>
            </details>
          ))
        )}
      </section>
      ) : null}
    </div>
  );
}
