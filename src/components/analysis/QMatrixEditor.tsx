"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { InfoTip } from "@/components/moodle/InfoTip";
import { CaveatNote } from "@/components/moodle/PageParts";
import { classConcept } from "@/lib/analysis/concepts";
import { itemsForConcept } from "@/lib/analysis/matrix";
import { pct } from "@/lib/format";
import { useQuiz } from "@/lib/state/QuizContext";
import { defaultProvenance, editedProvenance, type QProvenance, type TagProvenanceSource } from "@/lib/state/aiRecords";
import type { QMatrix } from "@/lib/types";
import { RelationEditor } from "./RelationEditor";
import { TagDraftCard, type TagApply } from "./TagDraftCard";
import { TagFitCheck } from "./TagFitCheck";

const PROV_TEXT: Record<TagProvenanceSource, string | null> = { default: null, ai: "AI 초안 반영", "ai-edited": "AI 초안 반영 후 수정", manual: "직접 수정" };

export function QMatrixEditor() {
  const { qmatrixHash, qReady } = useQuiz();
  if (!qReady) return <p className="muted">저장된 태그를 불러오는 중…</p>;
  // 저장된 Q-matrix가 바뀌면(복원·저장·초기화) 편집 초안을 새로 시작한다
  return <Editor key={qmatrixHash} />;
}

function Editor() {
  const { m, concepts, qmatrix, qprovenance, defaultQ, saveQMatrix, resetQMatrix, isDefaultQ, qStatus, decision, decisionStale, ds } = useQuiz();
  const [draft, setDraft] = useState<QMatrix>(() => structuredClone(qmatrix));
  const [prov, setProv] = useState<QProvenance>(() => structuredClone(qprovenance));
  const [message, setMessage] = useState<string | null>(null);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(qmatrix) || JSON.stringify(prov) !== JSON.stringify(qprovenance), [draft, qmatrix, prov, qprovenance]);
  const untagged = m.items.filter((it) => (draft[it.id] ?? []).length === 0);

  const toggle = (itemId: string, conceptId: string) => {
    setMessage(null);
    setDraft((d) => {
      const cur = d[itemId] ?? [];
      const next = cur.includes(conceptId) ? cur.filter((c) => c !== conceptId) : [...cur, conceptId];
      return { ...d, [itemId]: concepts.map((c) => c.id).filter((c) => next.includes(c)) };
    });
    setProv((p) => ({ ...p, [itemId]: editedProvenance(p[itemId]) }));
  };

  /** AI 초안 반영: 편집 중인 태그에만 들어간다 */
  const applyDraft = (updates: TagApply[], draftId: string) => {
    setDraft((d) => ({ ...d, ...Object.fromEntries(updates.map((u) => [u.itemId, concepts.map((c) => c.id).filter((c) => u.tags.includes(c))])) }));
    setProv((p) => ({ ...p, ...Object.fromEntries(updates.map((u) => [u.itemId, { source: "ai" as const, basedOnDraftId: draftId }])) }));
  };

  return (
    <div className="stack">
      <div className="alert alert-info">
        <p>
          문항마다 측정하는 개념을 체크합니다. 한 문항에 여러 개념을 체크하면, 그 문항의 오답은 체크한 모든 개념의 오답률에 똑같이 반영됩니다.
          수정 내용은 <strong>이 브라우저에만</strong> 저장되며 다른 기기나 다른 교수에게는 보이지 않습니다.
        </p>
      </div>
      {qStatus === "session-only" ? (
        <div className="alert alert-warning" role="status"><p>브라우저 저장소를 쓸 수 없어 저장 내용이 이번 세션에만 반영됩니다.</p></div>
      ) : null}
      {qStatus === "discarded" ? (
        <div className="alert alert-warning" role="status"><p>저장된 태그가 손상되었거나 이전 데이터 버전이라 버리고 기본 태그를 불러왔습니다.</p></div>
      ) : null}
      {decision && decisionStale ? (
        <div className="alert alert-warning" role="status">
          <p>저장된 보충 그룹안은 다른 태그로 만든 것입니다. <Link href={`/quiz/${ds.quiz.id}/groups/`}>보충 그룹에서 재검토</Link>가 필요합니다.</p>
        </div>
      ) : null}

      <TagDraftCard editorQ={draft} editorProv={prov} onApply={(u, id) => { setMessage(null); applyDraft(u, id); }} />

      <section className="card" aria-labelledby="qm-title">
        <h2 className="card-title" id="qm-title">문항마다 다루는 개념</h2>
        <p className="card-sub">노란 칸은 기본 태그와 다른 칸입니다.</p>
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">문제별 개념 편집</caption>
            <thead>
              <tr>
                <th scope="col">문항</th>
                {concepts.map((c) => <th key={c.id} scope="col" style={{ textAlign: "center" }}>{c.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {m.items.map((it) => (
                <tr key={it.id}>
                  <th scope="row" style={{ fontWeight: 400, maxWidth: 460 }}>
                    <strong>Q{it.number}</strong> {it.stem}
                    {(draft[it.id] ?? []).length === 0 ? <div className="small" style={{ color: "var(--warning-text)" }}>태그 없음: 어떤 개념 집계에도 들어가지 않습니다</div> : null}
                    {PROV_TEXT[prov[it.id]?.source ?? "default"] ? <div className="small muted">출처: {PROV_TEXT[prov[it.id]?.source ?? "default"]}</div> : null}
                  </th>
                  {concepts.map((c) => {
                    const checked = (draft[it.id] ?? []).includes(c.id);
                    const changed = checked !== (defaultQ[it.id] ?? []).includes(c.id);
                    return (
                      <td key={c.id} className={changed ? "qm-changed" : undefined} style={{ textAlign: "center", verticalAlign: "middle" }}>
                        <input
                          type="checkbox"
                          className="qm-check"
                          checked={checked}
                          onChange={() => toggle(it.id, c.id)}
                          aria-label={`Q${it.number} — ${c.name}${changed ? " (기본값과 다름)" : ""}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row" style={{ marginTop: "1rem" }}>
          <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => { saveQMatrix(draft, prov); setMessage("저장했습니다. 분석 화면이 새 태그로 다시 계산됩니다."); }}>
            이 브라우저에 저장
          </button>
          <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => { setDraft(structuredClone(qmatrix)); setProv(structuredClone(qprovenance)); setMessage("편집을 취소했습니다."); }}>
            편집 취소
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={isDefaultQ && !dirty}
            onClick={() => {
              resetQMatrix();
              // 저장된 태그가 이미 기본값이면 hash가 그대로라 Editor가 다시 마운트되지 않는다. 초안도 직접 되돌린다.
              setDraft(structuredClone(defaultQ));
              setProv(defaultProvenance(m.items.map((i) => i.id)));
              setMessage("기본 태그로 되돌렸습니다.");
            }}
          >
            기본 태그로 초기화
          </button>
          {dirty ? <span className="badge badge-demo">저장하지 않은 변경 있음</span> : null}
          <span role="status" className="small">{message}</span>
        </div>
        {untagged.length > 0 ? <CaveatNote>태그 없는 문항 {untagged.length}개는 개념 오답률에서 빠집니다.</CaveatNote> : null}
      </section>

      <section className="card" aria-labelledby="qm-preview">
        <h2 className="card-title" id="qm-preview">
          미리보기: 학급 개념 오답률
          <InfoTip label="미리보기">
            <span>편집 중인 태그로 다시 계산한 값입니다. 저장해야 다른 화면에 반영됩니다.</span>
          </InfoTip>
        </h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">개념</th>
                <th scope="col" className="num">현재 (저장됨)</th>
                <th scope="col" className="num">편집 중</th>
                <th scope="col">편집 중 태그 문항</th>
              </tr>
            </thead>
            <tbody>
              {concepts.map((c) => {
                const now = classConcept(m, qmatrix, c.id);
                const next = classConcept(m, draft, c.id);
                return (
                  <tr key={c.id}>
                    <th scope="row">{c.name}</th>
                    <td className="num">{pct(now.value)} <span className="muted small">({now.numerator}/{now.denominator})</span></td>
                    <td className="num">{pct(next.value)} <span className="muted small">({next.numerator}/{next.denominator})</span></td>
                    <td className="small">{itemsForConcept(m, draft, c.id).map((id) => `Q${m.items.find((i) => i.id === id)?.number}`).join(", ") || "없음"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <TagFitCheck draft={draft} />

      <RelationEditor editorDirty={dirty} />
    </div>
  );
}
