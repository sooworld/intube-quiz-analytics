"use client";
// 개념 관계 편집 (docs/decisions.md §8.3, §8.5). AI 초안 → 교수 확정. 응답 겹침은 접힌 "중복 현황"에서만 보여 준다.
import { useMemo, useState } from "react";
import { modelLabel } from "@/lib/ai/capabilities";
import { AiRunStatus } from "@/components/ai/AiRunStatus";
import { InfoTip } from "@/components/moodle/InfoTip";
import { CaveatNote } from "@/components/moodle/PageParts";
import { newId } from "@/lib/ai/client";
import { relationDraftBasis, relationDraftInput, relationDraftTask, type RelationDraftInput, type RelationDraftResult } from "@/lib/ai/tasks/relationDraft";
import { useDraftRun } from "@/lib/ai/useDraftRun";
import { itemsForConcept } from "@/lib/analysis/matrix";
import { detectCycle, overlapTable, RELATION_LABEL, unorderedKey, type RelationType } from "@/lib/analysis/relations";
import { formatDateTime, pct } from "@/lib/format";
import type { AiDraft, ConfirmedRelation } from "@/lib/state/aiRecords";
import { useQuiz } from "@/lib/state/QuizContext";
import type { ConceptId, ItemId } from "@/lib/types";

const TYPES: RelationType[] = ["prerequisite", "related", "confusable"];
const TYPE_HELP: Record<RelationType, string> = {
  prerequisite: "A를 알아야 B를 이해한다 (방향 있음)",
  related: "함께 쓰이거나 이어진다",
  confusable: "학생이 헷갈리기 쉽다",
};
const SOURCE_TEXT: Record<ConfirmedRelation["source"], string> = { ai: "AI 초안", "ai-edited": "AI 초안 수정", manual: "직접 추가" };
const STATUS_TEXT = { valid: "구조 검사 통과", "needs-review": "검토 필요", invalid: "확정 불가(형식 오류)" } as const;

export function RelationEditor({ editorDirty }: { editorDirty: boolean }) {
  const { ds, m, concepts, conceptById, qmatrix, relations, saveRelations, relReady, drafts, addDraft } = useQuiz();
  const runner = useDraftRun(relationDraftTask, { quizId: ds.quiz.id, dataVersion: ds.dataVersion, addDraft });
  const input = useMemo(() => relationDraftInput(concepts, ds.quiz.items, qmatrix), [concepts, ds.quiz.items, qmatrix]);
  const basis = useMemo(() => relationDraftBasis(input), [input]);
  const relDrafts = drafts.filter((d) => d.task === "relation-draft") as unknown as AiDraft<RelationDraftInput, RelationDraftResult>[];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeEdits, setTypeEdits] = useState<Record<string, RelationType>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState<{ from: ConceptId; to: ConceptId; type: RelationType; rationale: string }>({ from: concepts[0]!.id, to: concepts[1]?.id ?? concepts[0]!.id, type: "prerequisite", rationale: "" });

  const draft = relDrafts.find((d) => d.draftId === selectedId) ?? relDrafts.at(-1) ?? null;
  const stale = !!draft && draft.basisHash !== basis;
  const canConfirm = !!draft && !stale && !runner.unsaved && draft.result.status !== "invalid" && draft.result.flags.length === 0;
  const name = (id: ConceptId) => conceptById.get(id)?.name ?? id;
  const qs = (ids: ItemId[]) => ids.map((id) => `Q${ds.quiz.items.find((i) => i.id === id)?.number}`).join(", ") || "없음";
  const confirmedPairs = new Set(relations.map((r) => unorderedKey(r.from, r.to)));

  /** 저장 규칙 검사 후 저장: 같은 쌍 중복 금지, 선수 관계 순환 금지 */
  const commit = (next: ConfirmedRelation[], done: string): boolean => {
    const pairs = new Set(next.map((r) => unorderedKey(r.from, r.to)));
    if (pairs.size !== next.length) {
      setMessage("이미 확정된 관계가 있는 개념 쌍입니다. 기존 관계의 유형을 바꾸거나 삭제한 뒤 다시 시도하세요.");
      return false;
    }
    const cycle = detectCycle(next);
    if (cycle) {
      setMessage(`선수 관계가 순환합니다(${cycle.map(name).join(" → ")}). 저장하지 않았습니다.`);
      return false;
    }
    if (!saveRelations(next)) {
      setMessage("브라우저 저장소에 쓰지 못했습니다. 이번 세션에만 반영됩니다.");
      return true;
    }
    setMessage(done);
    return true;
  };

  const request = async () => {
    setMessage(null);
    setTypeEdits({});
    setDismissed(new Set());
    const d = await runner.run(input, basis);
    if (d) {
      setSelectedId(d.draftId);
      setMessage(`관계 초안을 받았습니다: ${STATUS_TEXT[d.result.status]}.`);
    }
  };

  const confirm = (k: string, r: RelationDraftResult["relations"][number]) => {
    if (!draft) return;
    const type = typeEdits[k] ?? r.type;
    const rel: ConfirmedRelation = {
      id: newId("rel", new Date()),
      from: r.from,
      to: r.to,
      type,
      rationale: r.rationale,
      fromItemIds: r.fromItemIds,
      toItemIds: r.toItemIds,
      source: type === r.type ? "ai" : "ai-edited",
      basedOnDraftId: draft.draftId,
      confirmedAt: new Date().toISOString(),
    };
    commit([...relations, rel], `${name(r.from)}–${name(r.to)} ${RELATION_LABEL[type]} 관계를 확정했습니다.`);
  };

  const changeType = (id: string, type: RelationType) => {
    commit(
      relations.map((r) => (r.id === id ? { ...r, type, source: r.source === "ai" ? ("ai-edited" as const) : r.source } : r)),
      "관계 유형을 바꿨습니다.",
    );
  };

  const addManual = () => {
    if (manual.from === manual.to) {
      setMessage("서로 다른 두 개념을 고르세요.");
      return;
    }
    const rel: ConfirmedRelation = {
      id: newId("rel", new Date()),
      from: manual.from,
      to: manual.to,
      type: manual.type,
      rationale: manual.rationale.trim(),
      fromItemIds: itemsForConcept(m, qmatrix, manual.from),
      toItemIds: itemsForConcept(m, qmatrix, manual.to),
      source: "manual",
      confirmedAt: new Date().toISOString(),
    };
    if (commit([...relations, rel], `${name(rel.from)}–${name(rel.to)} 관계를 추가했습니다.`)) setManual((s) => ({ ...s, rationale: "" }));
  };

  return (
    <section className="card" aria-labelledby="rel-title">
      <h2 className="card-title" id="rel-title">
        개념 관계 <span className="badge badge-info">초안 → 교수 확정</span>
        <InfoTip label="개념 관계">
          <span>
            관계는 교과 내용에 대한 교수의 판단입니다. 확정한 관계로 보충 그룹 화면에서 <strong>개념 묶음 보충 그룹</strong>을 만들 수 있습니다. 응답 데이터로 관계가 맞는지 판정하지 않습니다.
          </span>
        </InfoTip>
      </h2>
      {editorDirty ? (
        <div className="alert alert-info" role="status">
          <p>위에 저장하지 않은 태그 변경이 있습니다. 관계 초안과 근거 문항은 <strong>저장된 태그</strong>로 만듭니다.</p>
        </div>
      ) : null}

      <h3 style={{ fontSize: "var(--fs-lg)" }}>
        AI 관계 초안
        <InfoTip label="AI 관계 초안">
          <span>
            개념 설명, 문항 지문, 저장된 태그를 <strong>{runner.modelLabel}</strong>(으)로 보냅니다. 학생 응답은 보내지 않습니다.
          </span>
        </InfoTip>
      </h3>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={request} disabled={runner.busy}>
          {runner.busy ? "초안 받는 중…" : relDrafts.length > 0 ? "새 관계 초안 받기" : "관계 초안 받기"}
        </button>
        {runner.busy ? (
          <button type="button" className="btn btn-outline" onClick={runner.cancel}>
            취소
          </button>
        ) : null}
        {relDrafts.length > 1 ? (
          <label className="small">
            이전 초안{" "}
            <select value={draft?.draftId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
              {[...relDrafts].reverse().map((d) => (
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
          <p>초안을 브라우저에 저장하지 못해 확정할 수 없습니다. 저장 공간을 확인한 뒤 다시 받으세요.</p>
        </div>
      ) : null}

      {draft ? (
        <>
          <p className="small">
            <span className={`badge ${draft.result.status === "valid" ? "badge-ok" : draft.result.status === "invalid" ? "badge-danger" : "badge-demo"}`}>{STATUS_TEXT[draft.result.status]}</span>{" "}
            {formatDateTime(draft.createdAt)} · 요청 모델 {modelLabel(draft.provider, draft.requestedModel)}
            {draft.responseModel && modelLabel(draft.provider, draft.responseModel) !== modelLabel(draft.provider, draft.requestedModel) ? ` (응답 모델 ${modelLabel(draft.provider, draft.responseModel)})` : ""}
          </p>
          {stale ? <CaveatNote>이 초안은 지금과 다른 태그로 만든 것이라 확정할 수 없습니다. 새 초안을 받으세요.</CaveatNote> : null}
          {draft.result.flags.length > 0 ? <CaveatNote>입력에 지시문이 들어 있을 수 있어 확정을 막았습니다.</CaveatNote> : null}
          {draft.result.problems.length > 0 ? (
            <ul className="small">
              {draft.result.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {draft.result.relations.length === 0 && draft.result.status !== "invalid" ? <p className="small muted">제안된 관계가 없습니다(근거가 부족하면 제안하지 않도록 지시했습니다).</p> : null}
          {draft.result.relations.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <caption className="visually-hidden">AI 관계 제안</caption>
                <thead>
                  <tr>
                    <th scope="col">관계</th>
                    <th scope="col">유형</th>
                    <th scope="col">근거 문항</th>
                    <th scope="col">이유</th>
                    <th scope="col">확정</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.result.relations.map((r, i) => {
                    const k = `${draft.draftId}:${i}`;
                    if (dismissed.has(k)) return null;
                    const type = typeEdits[k] ?? r.type;
                    const done = confirmedPairs.has(unorderedKey(r.from, r.to));
                    return (
                      <tr key={k}>
                        <th scope="row">
                          {name(r.from)} {type === "prerequisite" ? "→" : "—"} {name(r.to)}
                        </th>
                        <td>
                          <label className="visually-hidden" htmlFor={`rt-${k}`}>
                            관계 유형
                          </label>
                          <select id={`rt-${k}`} value={type} disabled={done} onChange={(e) => setTypeEdits((t) => ({ ...t, [k]: e.target.value as RelationType }))}>
                            {TYPES.map((t) => (
                              <option key={t} value={t}>
                                {RELATION_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="small">
                          {name(r.from)}: {qs(r.fromItemIds)}
                          <br />
                          {name(r.to)}: {qs(r.toItemIds)}
                        </td>
                        <td className="small">
                          {r.rationale}
                          {r.issues.includes("evidence-untagged") ? <span className="badge badge-demo"> 근거 문항 태그 불일치</span> : null}
                          {r.issues.includes("no-evidence") ? <span className="badge badge-demo"> 한쪽 근거 없음</span> : null}
                          {r.issues.includes("cycle") ? <span className="badge badge-danger"> 순환</span> : null}
                        </td>
                        <td>
                          {done ? (
                            <span className="badge badge-ok">확정됨</span>
                          ) : (
                            <>
                              <button type="button" className="btn btn-sm btn-primary" disabled={!canConfirm || !relReady} onClick={() => confirm(k, r)}>
                                확정
                              </button>{" "}
                              <button type="button" className="btn btn-sm btn-outline" onClick={() => setDismissed((d) => new Set(d).add(k))}>
                                거부
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      <h3 style={{ fontSize: "var(--fs-lg)", marginTop: "1.25rem" }}>
        확정된 관계 {relations.length}개
      </h3>
      {relations.length === 0 ? (
        <p className="small muted">아직 확정한 관계가 없습니다. AI 초안에서 확정하거나 아래에서 직접 추가하세요.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">확정된 개념 관계</caption>
            <thead>
              <tr>
                <th scope="col">관계</th>
                <th scope="col">유형</th>
                <th scope="col">이유</th>
                <th scope="col">출처</th>
                <th scope="col">삭제</th>
              </tr>
            </thead>
            <tbody>
              {relations.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    {name(r.from)} {r.type === "prerequisite" ? "→" : "—"} {name(r.to)}
                  </th>
                  <td>
                    <label className="visually-hidden" htmlFor={`ct-${r.id}`}>
                      관계 유형
                    </label>
                    <select id={`ct-${r.id}`} value={r.type} onChange={(e) => changeType(r.id, e.target.value as RelationType)}>
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {RELATION_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="small">{r.rationale || <span className="muted">(이유 없음)</span>}</td>
                  <td className="small">{SOURCE_TEXT[r.source]}</td>
                  <td>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => commit(relations.filter((x) => x.id !== r.id), "관계를 삭제했습니다.")}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="inline-form"
        style={{ marginTop: "0.75rem", flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          addManual();
        }}
      >
        <label className="field">
          <span>개념 A</span>
          <select value={manual.from} onChange={(e) => setManual((s) => ({ ...s, from: e.target.value }))}>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>유형</span>
          <select value={manual.type} onChange={(e) => setManual((s) => ({ ...s, type: e.target.value as RelationType }))}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {RELATION_LABEL[t]}: {TYPE_HELP[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>개념 B</span>
          <select value={manual.to} onChange={(e) => setManual((s) => ({ ...s, to: e.target.value }))}>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>이유 (선택)</span>
          <input type="text" value={manual.rationale} maxLength={300} onChange={(e) => setManual((s) => ({ ...s, rationale: e.target.value }))} />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={!relReady}>
          직접 추가
        </button>
      </form>

      {relations.length > 0 ? (
        <details style={{ marginTop: "1rem" }}>
          <summary>보충 대상 중복 현황 (참고, 기준 50% 이상)</summary>
          <p className="small">겹침 정도일 뿐 관계가 맞는지 판단하는 근거가 아닙니다. 같은 학생들이 공통 실력·난이도 때문에 함께 틀려도 겹침은 커집니다.</p>
          {relations.map((r) => {
            const t = overlapTable(m, qmatrix, concepts, r.from, r.to);
            const a = name(r.from);
            const b = name(r.to);
            return (
              <div key={r.id} className="table-wrap">
                <table className="data">
                  <caption className="small" style={{ textAlign: "left" }}>
                    {a}–{b} ({RELATION_LABEL[r.type]}), 응시 {t.n}명
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col"></th>
                      <th scope="col" className="num">{b} 기준 이상</th>
                      <th scope="col" className="num">{b} 기준 미만</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">{a} 기준 이상</th>
                      <td className="num">{t.both}명</td>
                      <td className="num">{t.aOnly}명</td>
                    </tr>
                    <tr>
                      <th scope="row">{a} 기준 미만</th>
                      <td className="num">{t.bOnly}명</td>
                      <td className="num">{t.neither}명</td>
                    </tr>
                  </tbody>
                </table>
                {t.sharedItemIds.length > 0 ? (
                  <CaveatNote>
                    {qs(t.sharedItemIds)} 응답이 두 개념의 오답률 계산에 모두 들어갑니다. 공유 문항의 기여분은 분리하지 않았습니다.
                  </CaveatNote>
                ) : null}
              </div>
            );
          })}
          <p className="small muted">기준: 개념 관찰 오답률 {pct(0.5)} 이상(보충 그룹 기본값).</p>
        </details>
      ) : null}
    </section>
  );
}
