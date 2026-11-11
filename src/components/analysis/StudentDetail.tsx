"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { HBarCompare } from "@/components/charts/Bars";
import { InfoTip } from "@/components/moodle/InfoTip";
import { XapiEvidence } from "@/components/xapi/XapiEvidence";
import { classConcept, reviewPriorities, studentConcept } from "@/lib/analysis/concepts";
import { misconceptionCandidate } from "@/lib/analysis/grading";
import { totalScore } from "@/lib/analysis/itemStats";
import { isWrong } from "@/lib/analysis/matrix";
import { pct } from "@/lib/format";
import { useQuiz } from "@/lib/state/QuizContext";
import { AnswerCell } from "./AnswerCell";
import { QMatrixNotice } from "./QMatrixNotice";

export function StudentDetail({ sid }: { sid: string }) {
  const { ds, m, concepts, qmatrix, studentById, itemById, conceptById } = useQuiz();
  const [wrongOnly, setWrongOnly] = useState(false);
  const student = studentById.get(sid)!;
  const finished = m.students.some((s) => s.id === sid);
  const base = `/quiz/${ds.quiz.id}`;

  const idx = m.students.findIndex((s) => s.id === sid);
  const prev = idx > 0 ? m.students[idx - 1] : undefined;
  const next = idx >= 0 && idx < m.students.length - 1 ? m.students[idx + 1] : undefined;

  const priorities = useMemo(() => (finished ? reviewPriorities(m, qmatrix, concepts, sid) : []), [finished, m, qmatrix, concepts, sid]);

  if (!finished) {
    return (
      <div>
        <p><Link href={`${base}/analysis/`}>← 결과 분석</Link></p>
        <h2>{student.name}</h2>
        <div className="alert alert-warning"><p>이 학생은 퀴즈에 응시하지 않았습니다. 분석에서 제외됩니다.</p></div>
      </div>
    );
  }

  const score = totalScore(m, sid);
  const items = m.items.filter((it) => !wrongOnly || isWrong(m, sid, it.id));

  return (
    <div>
      <nav className="btn-row" aria-label="학생 이동" style={{ justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <Link href={`${base}/analysis/`}>← 결과 분석</Link>
        <span className="btn-row">
          {prev ? <Link className="btn btn-outline btn-sm" href={`${base}/student/${prev.id}/`}>← {prev.name}</Link> : null}
          {next ? <Link className="btn btn-outline btn-sm" href={`${base}/student/${next.id}/`}>{next.name} →</Link> : null}
        </span>
      </nav>
      <QMatrixNotice />

      <h2>{student.name} <span className="badge">{sid}</span></h2>
      <dl className="grid-4" style={{ margin: "0.75rem 0 1.25rem" }}>
        <div className="stat-tile">
          <dt className="label">점수</dt>
          <dd className="value" style={{ margin: 0 }}>{score} / {m.items.length}</dd>
          <dd className="detail" style={{ margin: 0 }}>정답률 {pct(score / m.items.length)}</dd>
        </div>
        <div className="stat-tile">
          <dt className="label">오답 · 무응답</dt>
          <dd className="value" style={{ margin: 0 }}>{m.items.length - score}문항</dd>
          <dd className="detail" style={{ margin: 0 }}>무응답 {m.items.filter((it) => m.state[sid]![it.id] === "unanswered").length}문항 포함</dd>
        </div>
        <div className="stat-tile" style={{ gridColumn: "span 2" }}>
          <dt className="label">우선 검토할 개념</dt>
          <dd className="value" style={{ margin: 0, fontSize: "var(--fs-lg)" }}>{priorities[0] ? conceptById.get(priorities[0].conceptId)?.name : "없음"}</dd>
          {priorities[0] ? (
            <dd className="detail" style={{ margin: 0 }}>연결 문항 {priorities[0].student.denominator}개 중 {priorities[0].student.numerator}개 오답</dd>
          ) : (
            <dd className="detail" style={{ margin: 0 }}>틀린 문항이 없습니다</dd>
          )}
        </div>
      </dl>

      <div className="split">
        <section className="card" aria-labelledby="sd-concepts">
          <h3 className="card-title" id="sd-concepts">
            개념별 오답률
            <InfoTip label="개념별 오답률">
              <span>막대는 이 학생이 그 개념의 문항 중 틀린 비율입니다. 개념당 문항이 2~4개뿐이라 한 문항 차이로 값이 크게 바뀝니다.</span>
            </InfoTip>
          </h3>
          <div className="legend">
            <span><span className="legend-swatch" style={{ background: "var(--series-1)" }} />{student.name}</span>
            <span><span className="legend-swatch" style={{ border: "2px dashed var(--text)", background: "transparent" }} />학급 전체</span>
          </div>
          <ul className="hbar-list">
            {concepts.map((c) => {
              const s = studentConcept(m, qmatrix, sid, c.id);
              const k = classConcept(m, qmatrix, c.id);
              return (
                <HBarCompare
                  key={c.id}
                  label={c.name}
                  student={s.value}
                  classValue={k.value}
                  valueText={s.value === null ? "자료 없음" : `${pct(s.value)} (${s.numerator}/${s.denominator})`}
                  classText={pct(k.value)}
                />
              );
            })}
          </ul>
        </section>

        <section className="card" aria-labelledby="sd-review">
          <h3 className="card-title" id="sd-review">
            복습 제안
            <InfoTip label="복습 제안">
              <span>이 학생의 오답률이 높은 개념부터 보여줍니다. 학급 평균은 참고용입니다.</span>
              <span>복습 제안은 관찰된 오답에 근거한 검토 제안이며, 개념 미숙달을 확정하지 않습니다.</span>
            </InfoTip>
          </h3>
          {priorities.length === 0 ? <p className="muted">틀린 문항이 없어 제안할 복습 개념이 없습니다.</p> : null}
          <ol className="stack" style={{ paddingLeft: "1.25rem" }}>
            {priorities.slice(0, 3).map((p) => {
              const c = conceptById.get(p.conceptId)!;
              return (
                <li key={p.conceptId}>
                  <strong>{c.name}</strong> — {p.student.denominator}문항 중 {p.student.numerator}문항 오답 <span className="muted small">(학급 {pct(p.classValue)})</span>
                  <div className="small">검토 내용: {c.description}</div>
                  <ul className="small" style={{ paddingLeft: "1rem" }}>
                    {p.student.evidenceItemIds.map((id) => {
                      const it = itemById.get(id)!;
                      const cand = m.state[sid]![id] === "incorrect" ? misconceptionCandidate(it, m.raw[sid]![id] ?? null) : null;
                      return (
                        <li key={id}>
                          Q{it.number} {m.state[sid]![id] === "unanswered" ? "무응답" : `오개념 후보: ${cand ?? "미분류"}`}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <section className="card" style={{ marginTop: "1rem" }} aria-labelledby="sd-items">
        <div className="btn-row" style={{ justifyContent: "space-between" }}>
          <h3 className="card-title" id="sd-items">문항별 응답</h3>
          <label className="small"><input type="checkbox" checked={wrongOnly} onChange={(e) => setWrongOnly(e.target.checked)} /> 틀린 문항만 보기</label>
        </div>
        <XapiEvidence
          key={sid}
          label={`점수 ${score} / ${m.items.length}`}
          itemIds={m.items.map((it) => it.id)}
          studentIds={[sid]}
          kind="correct"
          numerator={score}
          denominator={m.items.length}
          unit="문항"
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th scope="col">문항</th><th scope="col">다루는 개념</th><th scope="col">학생 답</th><th scope="col">채점</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <th scope="row" style={{ fontWeight: 400, maxWidth: 420 }}><strong>Q{it.number}</strong> {it.stem}</th>
                  <td className="small">{(qmatrix[it.id] ?? []).map((c) => conceptById.get(c)?.name).join(", ") || "없음"}</td>
                  <AnswerCell item={it} raw={m.raw[sid]![it.id] ?? null} state={m.state[sid]![it.id]!} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
