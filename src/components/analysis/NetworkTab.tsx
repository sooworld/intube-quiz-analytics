"use client";

import { useMemo, useState } from "react";
import { CONCEPT_COLORS, ItemNetwork } from "@/components/charts/ItemNetwork";
import { InfoTip } from "@/components/moodle/InfoTip";
import { itemNetwork, type EdgeBasis } from "@/lib/analysis/network";
import { MIN_CO_WRONG } from "@/lib/analysis/similarity";
import { useQuiz } from "@/lib/state/QuizContext";

const THRESHOLDS: Record<EdgeBasis, number[]> = {
  cowrong: [0.3, 0.4, 0.5, 0.6, 0.7],
  concept: [0.3, 0.5, 1],
};

export function NetworkTab() {
  const { m, qmatrix, concepts, itemById, conceptById } = useQuiz();
  const [basis, setBasis] = useState<EdgeBasis>("cowrong");
  const [threshold, setThreshold] = useState(0.5);
  const [selected, setSelected] = useState<string | null>(null);
  const edges = useMemo(() => itemNetwork(m, qmatrix, basis, threshold), [m, qmatrix, basis, threshold]);
  const shown = selected ? edges.filter((e) => e.a === selected || e.b === selected) : edges;
  const num = (id: string) => itemById.get(id)?.number;
  const cowrong = basis === "cowrong";

  const changeBasis = (b: EdgeBasis) => {
    setBasis(b);
    setThreshold(b === "cowrong" ? 0.5 : 0.3);
  };

  return (
    <div className="split">
      <section className="card" aria-labelledby="nw-title">
        <h2 className="card-title" id="nw-title">
          문제 관계도
          <InfoTip label="문제 관계도">
            <span>동그라미 하나가 문항 하나입니다. 고른 기준에서 비슷한 두 문항을 선으로 잇고, 더 비슷할수록 선을 굵게 그립니다.</span>
            <span>“함께 틀린 학생”과 “같은 개념”은 서로 다른 정보라 한 그림에 섞지 않습니다.</span>
            {cowrong ? <span>함께 틀렸다고 같은 개념을 묻는 문항이라는 뜻은 아닙니다.</span> : null}
            <span>비슷한 문항끼리 선으로 이었습니다. 동그라미를 누르면 그 문항의 연결만 보입니다.</span>
          </InfoTip>
        </h2>
        <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
          <span className="chip-toggle" role="group" aria-label="무엇으로 이을지">
            <button type="button" aria-pressed={cowrong} onClick={() => changeBasis("cowrong")}>함께 틀린 학생 기준</button>
            <button type="button" aria-pressed={!cowrong} onClick={() => changeBasis("concept")}>같은 개념 기준</button>
          </span>
          <label htmlFor="nw-th" className="small">선 긋는 기준</label>
          <select id="nw-th" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
            {THRESHOLDS[basis].map((t) => <option key={t} value={t}>{cowrong ? `겹침 ${t} 이상` : `공통 개념 비율 ${t} 이상`}</option>)}
          </select>
          <InfoTip label="선 긋는 기준">
            {cowrong ? (
              <>
                <span>겹침 = 두 문항을 모두 틀린 학생 수 ÷ 둘 중 하나라도 틀린 학생 수 (Jaccard 지수, 0~1). 1이면 틀린 학생이 완전히 같습니다.</span>
                <span>함께 틀린 학생이 {MIN_CO_WRONG}명 미만인 쌍은 근거가 부족해 잇지 않습니다.</span>
              </>
            ) : (
              <span>공통 개념 비율 = 두 문항이 함께 가진 개념 수 ÷ 두 문항 개념을 합친 수 (0~1). 교수가 정한 문제별 개념만 보고, 학생 응답과는 무관합니다.</span>
            )}
          </InfoTip>
        </div>
        <div className="legend">
          <span className="small">
            색 = 문제가 다루는 수업 내용
            <InfoTip label="수업 내용 색">
              <span>아래 이름은 분석 용어가 아니라 이 퀴즈가 다루는 수업 내용(개념)입니다. 과목마다 교수가 정한 개념 이름이 들어갑니다.</span>
              {concepts.map((c) => (
                <span key={c.id}><strong>{c.name}</strong>: {c.description}</span>
              ))}
            </InfoTip>
          </span>
          {concepts.map((c, i) => (
            <span key={c.id}><span className="legend-swatch" style={{ background: CONCEPT_COLORS[i % CONCEPT_COLORS.length] }} />{c.name}</span>
          ))}
          <span><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeDasharray="3 2" /></svg> 두 번째 수업 내용</span>
          <span className="muted">바깥 숫자 = 이어진 선 수</span>
        </div>
        <ItemNetwork items={m.items} concepts={concepts} qmatrix={qmatrix} edges={edges} selected={selected} onSelect={setSelected} />
      </section>

      <section className="evidence" aria-live="polite" aria-labelledby="nw-list">
        <h3 id="nw-list">{selected ? `Q${num(selected)}의 연결` : `연결 목록 (${edges.length}개)`}</h3>
        {selected ? (
          <>
            <p className="small">
              {itemById.get(selected)?.stem}{" "}
              <button type="button" className="btn btn-link btn-sm" onClick={() => setSelected(null)}>전체 보기</button>
            </p>
            <p className="small">
              <strong>다루는 수업 내용:</strong>{" "}
              {(qmatrix[selected] ?? []).map((id) => {
                const c = conceptById.get(id);
                return c ? `${c.name} (${c.description})` : id;
              }).join(", ") || "없음"}
            </p>
          </>
        ) : (
          <p className="small muted">동그라미를 누르거나 Tab으로 이동해 Enter를 누르면 그 문항의 연결만 보여줍니다.</p>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">문항 쌍</th>
                <th scope="col" className="num">{cowrong ? "겹침" : "공통 개념 비율"}</th>
                <th scope="col" className="num">{cowrong ? "함께 틀린 학생" : "공통 개념 수"}</th>
                <th scope="col">공통 개념</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.a + e.b}>
                  <th scope="row">Q{num(e.a)} · Q{num(e.b)}</th>
                  <td className="num">{e.weight.toFixed(2)}</td>
                  <td className="num">{e.support}{cowrong ? "명" : "개"}</td>
                  <td className="small">{e.sharedConcepts.map((c) => conceptById.get(c)?.name).join(", ") || <span className="muted">없음</span>}</td>
                </tr>
              ))}
              {shown.length === 0 ? <tr><td colSpan={4} className="muted">이 조건에서 연결이 없습니다.</td></tr> : null}
            </tbody>
          </table>
        </div>
        {cowrong && shown.some((e) => e.sharedConcepts.length === 0) ? (
          <p className="small" style={{ marginTop: "0.75rem" }}>
            공통 개념이 없는데 함께 틀린 쌍이 있습니다. 바탕이 되는 개념이 따로 있는지, 문항에 개념 연결이 빠졌는지 문항 내용을 확인해 보세요.
          </p>
        ) : null}
      </section>
    </div>
  );
}
