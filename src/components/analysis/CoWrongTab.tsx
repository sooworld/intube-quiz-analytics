"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { seqColor } from "@/components/charts/scale";
import { InfoTip } from "@/components/moodle/InfoTip";
import { MIN_CO_WRONG, itemSimilarityMatrix, rankedItemPairs, type ItemPair } from "@/lib/analysis/similarity";
import { isWrong } from "@/lib/analysis/matrix";
import { useQuiz } from "@/lib/state/QuizContext";

export function CoWrongTab() {
  const { ds, m, itemById, qmatrix, conceptById } = useQuiz();
  const mat = useMemo(() => itemSimilarityMatrix(m), [m]);
  const ranked = useMemo(() => rankedItemPairs(m).filter((p) => p.sufficient).slice(0, 8), [m]);
  const [sel, setSel] = useState<ItemPair | null>(null);

  const sharedConcepts = (p: ItemPair) => {
    const a = new Set(qmatrix[p.a] ?? []);
    return (qmatrix[p.b] ?? []).filter((c) => a.has(c)).map((c) => conceptById.get(c)?.name ?? c);
  };
  const num = (id: string) => itemById.get(id)?.number;

  return (
    <div className="stack">
      <div className="split">
        <section className="card" aria-labelledby="cw-title">
          <h2 className="card-title" id="cw-title">
            두 문항을 함께 틀린 정도
            <InfoTip label="겹침">
              <span>겹침 = 두 문항을 모두 틀린 학생 수 ÷ 둘 중 하나라도 틀린 학생 수 (Jaccard 지수, 0~1). 1에 가까울수록 같은 학생들이 틀렸습니다.</span>
              <span>대각선 칸은 그 문항을 틀린 학생 수입니다.</span>
              <span>칸을 누르면 두 문항을 함께 틀린 학생이 나옵니다.</span>
            </InfoTip>
          </h2>
          <div className="legend" aria-hidden="true">
            <span>겹침</span>
            <span className="legend-scale">
              {[0.2, 0.35, 0.5, 0.65, 0.8, 1].map((v) => {
                const c = seqColor(v);
                return <span key={v} style={{ background: c.bg, color: c.fg }}>≤{v}</span>;
              })}
            </span>
            <span><span className="legend-swatch hatch" />근거 부족(함께 틀린 학생 {MIN_CO_WRONG}명 미만)</span>
          </div>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="matrix">
              <caption className="visually-hidden">문항 쌍별 함께 틀린 정도(겹침)</caption>
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">문항</span></th>
                  {m.items.map((it) => <th key={it.id} scope="col">Q{it.number}</th>)}
                </tr>
              </thead>
              <tbody>
                {mat.map((row, i) => (
                  <tr key={m.items[i]!.id}>
                    <th scope="row">Q{m.items[i]!.number}</th>
                    {row.map((p, j) => {
                      if (i === j) {
                        return <td key={p.b}><span className="diag" title={`Q${num(p.a)} 오답 ${p.wrongA}명`}>{p.wrongA}명</span></td>;
                      }
                      const insufficient = !p.sufficient || p.jaccard === null;
                      const c = !insufficient ? seqColor(p.jaccard!) : null;
                      const label = `Q${num(p.a)}과 Q${num(p.b)}: 함께 틀림 ${p.coWrong}명 / 하나라도 틀림 ${p.union}명${p.jaccard === null ? " (오답자 없음)" : `, 겹침 ${p.jaccard.toFixed(2)}`}${insufficient ? ", 근거 부족" : ""}`;
                      return (
                        <td key={p.b}>
                          <button
                            type="button"
                            className={insufficient ? "hatch" : undefined}
                            style={c ? { background: c.bg, color: c.fg } : { color: "var(--text-muted)" }}
                            aria-pressed={sel?.a === p.a && sel?.b === p.b}
                            aria-label={label}
                            title={label}
                            onClick={() => setSel(p)}
                          >
                            {insufficient ? "–" : p.jaccard!.toFixed(2)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="evidence" aria-live="polite" aria-labelledby="cw-detail">
          {sel ? (
            <>
              <h3 id="cw-detail">Q{num(sel.a)} · Q{num(sel.b)}</h3>
              <p className="small">
                Q{num(sel.a)} 오답 {sel.wrongA}명 · Q{num(sel.b)} 오답 {sel.wrongB}명 · <strong>함께 틀림 {sel.coWrong}명</strong> / 하나라도 틀림 {sel.union}명
                {sel.jaccard !== null ? ` · 겹침 ${sel.jaccard.toFixed(2)}` : " · 오답자 없음"}
              </p>
              {!sel.sufficient ? <p className="badge badge-danger">근거 부족: 함께 틀린 학생이 {MIN_CO_WRONG}명 미만</p> : null}
              <p className="small"><strong>공통 개념:</strong> {sharedConcepts(sel).join(", ") || "없음"}</p>
              <p className="small"><strong>함께 틀린 학생:</strong> {m.students.filter((s) => isWrong(m, s.id, sel.a) && isWrong(m, s.id, sel.b)).map((s) => s.name).join(", ") || "없음"}</p>
              <ul className="small" style={{ paddingLeft: "1.25rem" }}>
                <li>Q{num(sel.a)}: {itemById.get(sel.a)?.stem}</li>
                <li>Q{num(sel.b)}: {itemById.get(sel.b)?.stem}</li>
              </ul>
            </>
          ) : (
            <>
              <h3 id="cw-detail">문항 쌍 고르기</h3>
              <p className="muted">표의 칸이나 아래 목록에서 문항 쌍을 고르면 함께 틀린 학생과 공통 개념을 보여줍니다.</p>
            </>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="cw-rank">
        <h2 className="card-title" id="cw-rank">
          많이 함께 틀린 문항 쌍 (상위 8개)
          <InfoTip label="상위 문항 쌍">
            <span>함께 틀린 학생이 {MIN_CO_WRONG}명 이상인 쌍만 겹침 순으로 보여줍니다.</span>
            <span>“함께 틀림”과 “공통 개념”은 서로 다른 기준이라 열을 나눠 보여줍니다.</span>
            <span>함께 틀렸다고 같은 개념을 묻는 문항이라는 뜻은 아닙니다. 두 문항이 같은 개념을 묻는지는 문항 내용과 문제별 개념으로 따로 판단하세요.</span>
            <span>
              이 인원에서는 쌍 하나의 값이 크게 흔들리므로, 개념별로 묶어 본 비교는{" "}
              <Link href={`/quiz/${ds.quiz.id}/qmatrix/`}>문제별 개념 화면</Link>의 점검 카드에서 확인하세요.
            </span>
          </InfoTip>
        </h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">문항 쌍</th>
                <th scope="col" className="num">함께 틀림 / 하나라도 틀림</th>
                <th scope="col" className="num">겹침</th>
                <th scope="col">공통 개념</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p) => (
                <tr key={p.a + p.b} className={sel?.a === p.a && sel?.b === p.b ? "is-selected" : undefined}>
                  <th scope="row">
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setSel(p)}>Q{num(p.a)} · Q{num(p.b)}</button>
                  </th>
                  <td className="num">{p.coWrong} / {p.union}</td>
                  <td className="num">{p.jaccard?.toFixed(2) ?? "–"}</td>
                  <td>{sharedConcepts(p).join(", ") || <span className="muted">없음</span>}</td>
                </tr>
              ))}
              {ranked.length === 0 ? (
                <tr><td colSpan={4} className="muted">함께 틀린 학생이 충분한 문항 쌍이 없습니다.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
