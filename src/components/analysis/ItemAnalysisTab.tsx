"use client";

import { useState } from "react";
import { HBar } from "@/components/charts/Bars";
import { InfoTip } from "@/components/moodle/InfoTip";
import { XapiEvidence } from "@/components/xapi/XapiEvidence";
import type { ItemStat } from "@/lib/analysis/itemStats";
import { pct } from "@/lib/format";
import { useQuiz } from "@/lib/state/QuizContext";

export function ItemAnalysisTab({ stats }: { stats: ItemStat[] }) {
  const { itemById, conceptById, qmatrix, m } = useQuiz();
  const [selected, setSelected] = useState<string>(stats[0]?.itemId ?? "");
  const stat = stats.find((s) => s.itemId === selected);
  const item = stat ? itemById.get(stat.itemId) : undefined;
  const n = m.students.length;

  return (
    <div className="split">
      <section className="card" aria-labelledby="ia-title">
        <h2 className="card-title" id="ia-title">
          문제별 정답률
          <InfoTip label="문제별 정답률">
            <span>행을 누르면 선택지 분포(객관식)나 답안 묶음(단답)이 나옵니다.</span>
          </InfoTip>
        </h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">문항</th>
                <th scope="col">다루는 개념</th>
                <th scope="col" className="num">정답률</th>
                <th scope="col" className="num">무응답</th>
                <th scope="col" className="num">
                  변별도
                  <InfoTip label="변별도">
                    <span>점수가 높은 학생은 맞히고 낮은 학생은 틀리는 정도입니다. 0보다 작으면 오히려 점수가 낮은 학생이 더 잘 맞힌 문항이니 문항을 다시 확인하세요.</span>
                    <span>문항 점수와 나머지 문항 총점의 상관(Moodle 퀴즈 통계 방식)이며, 응시 {n}명 기준 참고값이라 한두 명의 응답으로 크게 달라질 수 있습니다.</span>
                  </InfoTip>
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const it = itemById.get(s.itemId)!;
                const isSel = s.itemId === selected;
                return (
                  <tr key={s.itemId} className={isSel ? "is-selected" : undefined}>
                    <th scope="row">
                      <button type="button" className="btn btn-link btn-sm" aria-pressed={isSel} onClick={() => setSelected(s.itemId)}>
                        Q{it.number} {it.type === "short" ? "(단답)" : ""}
                      </button>
                    </th>
                    <td className="small">{(qmatrix[s.itemId] ?? []).map((c) => conceptById.get(c)?.name).join(", ") || <span className="muted">없음</span>}</td>
                    <td className="num">{pct(s.facility.value)} <span className="muted small">({s.facility.numerator}/{s.facility.denominator})</span></td>
                    <td className="num">{s.unanswered}</td>
                    <td className="num">{s.discrimination === null ? <span className="muted">계산 불가</span> : s.discrimination.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="evidence" aria-live="polite" aria-labelledby="ia-detail">
        {stat && item ? (
          <>
            <h3 id="ia-detail">Q{item.number}</h3>
            <p>{item.stem}</p>
            <XapiEvidence
              key={stat.itemId}
              label={`정답률 ${pct(stat.facility.value)} (${stat.facility.numerator}/${stat.facility.denominator})`}
              itemIds={[stat.itemId]}
              kind="correct"
              numerator={stat.facility.numerator}
              denominator={stat.facility.denominator}
              unit="명"
            />
            <p className="small muted">무응답 {stat.unanswered}명</p>
            {stat.options ? (
              <>
                <h4>선택지 분포</h4>
                <ul className="hbar-list">
                  {stat.options.map((o) => (
                    <HBar
                      key={o.optionId}
                      label={
                        <>
                          <strong>{o.optionId}</strong> {o.isCorrect ? <span className="badge badge-ok">✓ 정답</span> : null}
                          <div className="small muted">{o.text}</div>
                          {o.misconception ? <div className="small">오개념 후보: {o.misconception}</div> : null}
                        </>
                      }
                      value={n ? o.count / n : null}
                      color={o.isCorrect ? "var(--series-1)" : "var(--seq-3)"}
                      valueText={`${o.count}명 (${pct(n ? o.count / n : null)})`}
                    />
                  ))}
                  {stat.unanswered > 0 ? (
                    <HBar label={<span className="muted">무응답</span>} value={stat.unanswered / n} color="var(--border-strong)" valueText={`${stat.unanswered}명`} />
                  ) : null}
                </ul>
              </>
            ) : null}
            {stat.shortGroups ? (
              <>
                <h4>
                  같은 답끼리 묶기
                  <InfoTip label="답 묶기 기준">
                    <span>앞뒤 공백·전각 문자·대소문자 차이만 무시하고 같은 답으로 묶습니다.</span>
                    <span>오개념 후보는 교수가 정한 규칙에 맞는 답에만 붙고, 규칙에 없는 오답은 “미분류”로 남습니다.</span>
                  </InfoTip>
                </h4>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th scope="col">답</th><th scope="col">채점</th><th scope="col">오개념 후보</th><th scope="col" className="num">인원</th></tr>
                    </thead>
                    <tbody>
                      {stat.shortGroups.map((g) => (
                        <tr key={g.key}>
                          <td>
                            <span className="answer-chip">{g.key}</span>
                            {g.examples.length > 1 || g.examples[0] !== g.key ? (
                              <div className="small muted">원답안: {g.examples.map((e) => `“${e}”`).join(", ")}</div>
                            ) : null}
                          </td>
                          <td className={g.correct ? "state-correct" : "state-incorrect"}>{g.correct ? "정답" : "오답"}</td>
                          <td className="small">{g.correct ? "–" : g.misconception ?? <span className="muted">미분류</span>}</td>
                          <td className="num">{g.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <p className="muted">문항을 고르세요.</p>
        )}
      </section>
    </div>
  );
}
