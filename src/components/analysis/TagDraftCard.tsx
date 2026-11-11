"use client";
// AI 태그 초안 카드 (docs/decisions.md §8.3). 반영은 편집 중인 태그에만 들어가고, 저장은 교수가 누른다.
import { useMemo, useState } from "react";
import { modelLabel } from "@/lib/ai/capabilities";
import { AiRunStatus } from "@/components/ai/AiRunStatus";
import { InfoTip } from "@/components/moodle/InfoTip";
import { CaveatNote } from "@/components/moodle/PageParts";
import { tagDraftBasis, tagDraftInput, tagDraftTask, type TagDraftInput, type TagDraftResult } from "@/lib/ai/tasks/tagDraft";
import { useDraftRun } from "@/lib/ai/useDraftRun";
import { formatDateTime } from "@/lib/format";
import type { AiDraft, QProvenance } from "@/lib/state/aiRecords";
import { useQuiz } from "@/lib/state/QuizContext";
import type { ConceptId, ItemId, QMatrix } from "@/lib/types";

const STATUS_TEXT = { valid: "구조·출처 검사 통과", "needs-review": "검토 필요", invalid: "반영 불가(형식 오류)" } as const;
const SOURCE_TEXT = { stem: "지문", option: "선택지", answer: "정답" } as const;

export interface TagApply {
  itemId: ItemId;
  tags: ConceptId[];
}

export function TagDraftCard({ editorQ, editorProv, onApply }: { editorQ: QMatrix; editorProv: QProvenance; onApply: (updates: TagApply[], draftId: string) => void }) {
  const { ds, concepts, conceptById, drafts, addDraft } = useQuiz();
  const runner = useDraftRun(tagDraftTask, { quizId: ds.quiz.id, dataVersion: ds.dataVersion, addDraft });
  const input = useMemo(() => tagDraftInput(concepts, ds.quiz.items), [concepts, ds.quiz.items]);
  const basis = useMemo(() => tagDraftBasis(input), [input]);
  const tagDrafts = drafts.filter((d) => d.task === "tag-draft") as unknown as AiDraft<TagDraftInput, TagDraftResult>[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<ItemId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const draft = tagDrafts.find((d) => d.draftId === selectedId) ?? tagDrafts.at(-1) ?? null;
  const stale = !!draft && draft.basisHash !== basis;
  const injection = !!draft && draft.result.flags.includes("injection-suspected");
  const canApply = !!draft && !stale && !runner.unsaved && draft.result.status !== "invalid" && !injection;
  const name = (id: ConceptId) => conceptById.get(id)?.name ?? id;
  const number = (id: ItemId) => ds.quiz.items.find((i) => i.id === id)?.number;

  const rows = draft
    ? draft.result.items.map((r) => {
        const suggested = r.tags.map((t) => t.conceptId);
        const current = editorQ[r.itemId] ?? [];
        const added = suggested.filter((c) => !current.includes(c));
        const removed = current.filter((c) => !suggested.includes(c));
        const blocked = r.issues.length > 0 || r.tags.some((t) => t.issues.length > 0);
        return { row: r, suggested, current, added, removed, same: added.length === 0 && removed.length === 0, blocked, manual: editorProv[r.itemId]?.source === "manual" };
      })
    : [];

  const request = async () => {
    setMessage(null);
    setConfirmItem(null);
    const d = await runner.run(input, basis);
    if (d) {
      setSelectedId(d.draftId);
      setMessage(`초안을 받았습니다: ${STATUS_TEXT[d.result.status]}.`);
    }
  };

  const apply = (items: typeof rows) => {
    if (!draft || items.length === 0) return;
    onApply(items.map((x) => ({ itemId: x.row.itemId, tags: x.suggested })), draft.draftId);
    setConfirmItem(null);
    setMessage(`${items.map((x) => `Q${number(x.row.itemId)}`).join(", ")}에 초안을 반영했습니다. 저장해야 분석에 쓰입니다.`);
  };

  const applicable = rows.filter((x) => !x.same && !x.blocked);
  const applyAll = () => {
    const skipped = applicable.filter((x) => x.manual);
    apply(applicable.filter((x) => !x.manual));
    if (skipped.length > 0) setMessage((m) => `${m ?? ""} 직접 고친 문항 ${skipped.map((x) => `Q${number(x.row.itemId)}`).join(", ")}은 건너뛰었습니다(문항별로 덮어쓰기 가능).`);
  };

  return (
    <section className="card" aria-labelledby="tag-draft-title">
      <h2 className="card-title" id="tag-draft-title">
        AI 태그 초안 <span className="badge badge-info">초안</span>
        <InfoTip label="AI 태그 초안">
          <span>
            문항·선택지·정답·개념 설명을 <strong>{runner.modelLabel}</strong>(으)로 보내 개념 태그 초안을 받습니다. 학생 응답은 보내지 않습니다. 반영해도 아래 편집 중인 태그에만 들어가고, 저장해야 분석에 쓰입니다.
          </span>
        </InfoTip>
      </h2>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={request} disabled={runner.busy}>
          {runner.busy ? "초안 받는 중…" : tagDrafts.length > 0 ? "새 초안 받기" : "초안 받기"}
        </button>
        {runner.busy ? (
          <button type="button" className="btn btn-outline" onClick={runner.cancel}>
            취소
          </button>
        ) : null}
        {tagDrafts.length > 1 ? (
          <label className="small">
            이전 초안{" "}
            <select value={draft?.draftId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
              {[...tagDrafts].reverse().map((d) => (
                <option key={d.draftId} value={d.draftId}>
                  {formatDateTime(d.createdAt)} · {modelLabel(d.provider, d.requestedModel)} · {STATUS_TEXT[d.result.status]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <AiRunStatus runInfo={runner.runInfo} busy={runner.busy} wait={runner.wait} error={runner.error} retryable={runner.retryable} idleMessage={message} onRetry={request} />
      {runner.unsaved ? (
        <div className="alert alert-warning" role="alert">
          <p>초안을 브라우저에 저장하지 못해 반영할 수 없습니다(근거 기록 없이 확정되는 것을 막기 위해). 저장 공간을 확인한 뒤 다시 받으세요.</p>
        </div>
      ) : null}

      {draft ? (
        <>
          <p className="small">
            <span className={`badge ${draft.result.status === "valid" ? "badge-ok" : draft.result.status === "invalid" ? "badge-danger" : "badge-demo"}`}>{STATUS_TEXT[draft.result.status]}</span>{" "}
            {formatDateTime(draft.createdAt)} · 요청 모델 {modelLabel(draft.provider, draft.requestedModel)}
            {draft.responseModel && modelLabel(draft.provider, draft.responseModel) !== modelLabel(draft.provider, draft.requestedModel) ? ` (응답 모델 ${modelLabel(draft.provider, draft.responseModel)})` : ""} · 프롬프트 {draft.promptVersion}
          </p>
          {stale ? (
            <div className="alert alert-warning" role="status">
              <p>이 초안은 지금과 다른 문항·개념으로 만든 것이라 반영할 수 없습니다. 새 초안을 받으세요.</p>
            </div>
          ) : null}
          {draft.result.problems.length > 0 ? (
            <details open={draft.result.status === "invalid"}>
              <summary className="small">{draft.result.status === "invalid" ? "형식 오류" : "검토할 점"} {draft.result.problems.length}건</summary>
              <ul className="small">
                {draft.result.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {injection ? <CaveatNote>문항에 지시문이 들어 있을 수 있어 반영을 막았습니다. 원문을 확인하고 직접 태그하세요.</CaveatNote> : null}

          {rows.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <caption className="visually-hidden">AI 태그 초안과 편집 중인 태그 비교</caption>
                <thead>
                  <tr>
                    <th scope="col">문항</th>
                    <th scope="col">편집 중 태그</th>
                    <th scope="col">AI 제안과 근거</th>
                    <th scope="col">반영</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.row.itemId}>
                      <th scope="row">Q{number(x.row.itemId)}</th>
                      <td className="small">{x.current.map(name).join(", ") || "없음"}</td>
                      <td className="small">
                        {x.same ? <span className="badge">같음</span> : null}
                        {x.added.map((c) => (
                          <span key={`a-${c}`} className="badge badge-info" style={{ marginRight: 4 }}>
                            AI 추가: {name(c)}
                          </span>
                        ))}
                        {x.removed.map((c) => (
                          <span key={`r-${c}`} className="badge badge-demo" style={{ marginRight: 4 }}>
                            AI 제거: {name(c)}
                          </span>
                        ))}
                        {x.row.tags.length === 0 ? <span className="badge badge-demo">제안 태그 없음</span> : null}
                        <details>
                          <summary>근거 {x.row.tags.length}건</summary>
                          <ul>
                            {x.row.tags.map((t) => (
                              <li key={t.conceptId}>
                                <strong>{name(t.conceptId)}</strong> · {SOURCE_TEXT[t.source]}
                                {t.optionId ? ` ${t.optionId}` : ""}: &ldquo;{t.quote}&rdquo; — {t.rationale}
                                {t.issues.includes("quote-mismatch") ? <span className="badge badge-danger"> 인용이 원문에 없음</span> : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td>
                        {confirmItem === x.row.itemId ? (
                          <div className="small" role="group" aria-label={`Q${number(x.row.itemId)} 덮어쓰기 확인`}>
                            <p>직접 고친 태그({x.current.map(name).join(", ") || "없음"})를 덮어씁니다.</p>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => apply([x])}>
                              덮어쓰기
                            </button>{" "}
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => setConfirmItem(null)}>
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            disabled={!canApply || x.same || x.blocked}
                            title={x.blocked ? "근거를 확인해야 해서 직접 체크하세요" : undefined}
                            onClick={() => (x.manual ? setConfirmItem(x.row.itemId) : apply([x]))}
                          >
                            이 문항에 반영
                          </button>
                        )}
                        {x.blocked && !x.same ? <div className="small muted">근거 확인 필요</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {draft.result.conceptGaps.length > 0 ? (
            <CaveatNote>
              목록에 없는 개념 후보(자동으로 추가하지 않음): {draft.result.conceptGaps.map((g) => `Q${number(g.itemId)} ${g.suggestedName}`).join(", ")}
            </CaveatNote>
          ) : null}
          <div className="btn-row" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="btn btn-secondary" disabled={!canApply || applicable.length === 0} onClick={applyAll}>
              차이 나는 문항 모두 반영 ({applicable.length})
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
