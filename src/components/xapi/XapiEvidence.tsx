"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useQuiz } from "@/lib/state/QuizContext";
import { collectEvidence, evidenceNumerator, evidenceTotal, type EvidenceRow } from "@/lib/xapi/evidence";
import { statementsUrl } from "@/lib/xapi/load";
import { StatementJson } from "./StatementJson";
import { useQuizStatements } from "./useQuizStatements";

interface Props {
  /** 화면에 보이는 숫자 그대로 (예: "정답률 68% (17/25)") */
  label: ReactNode;
  itemIds: string[];
  /** 없으면 응시 완료 학생 전체 */
  studentIds?: string[];
  /** 화면 숫자의 분자: 정답 수(정답률·점수) 또는 오답+무응답 수(오답률) */
  kind: "correct" | "wrong";
  numerator: number;
  denominator: number;
  /** "Statement 없음" 건수의 단위 (명·문항·칸) */
  unit: string;
}

/** 화면 숫자 → 그 숫자를 만든 Statement (docs/xapi-plan.md §3.5, L3) */
export function XapiEvidence({ label, itemIds, studentIds, kind, numerator, denominator, unit }: Props) {
  const { ds, studentById, itemById } = useQuiz();
  const { data, status, error, load } = useQuizStatements(ds);
  const [open, setOpen] = useState(false);

  const ev = useMemo(
    () => (data ? collectEvidence(ds, data.sources, data.byId, { itemIds, studentIds }) : null),
    [data, ds, itemIds, studentIds],
  );

  if (!ev) {
    return (
      <div className="xapi-ev">
        <button type="button" className="fact-chip" aria-busy={status === "loading"} onClick={() => { setOpen(true); load(); }}>
          {label}
        </button>{" "}
        <span className="small muted">{status === "loading" ? "Statement 파일을 받는 중…" : "← 누르면 이 숫자를 만든 xAPI Statement를 보여 줍니다"}</span>
        {status === "error" ? <div className="alert alert-warning small"><p>{error} 다시 누르면 재시도합니다.</p></div> : null}
      </div>
    );
  }

  const matches = evidenceNumerator(ev, kind) === numerator && evidenceTotal(ev) === denominator;
  const rows: [string, EvidenceRow[]][] = [["정답", ev.correct], ["오답", ev.incorrect], ["Statement 없음(무응답)", ev.missing]];

  return (
    <div className="xapi-ev">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="small">
          <strong>{label}</strong> — 정답 Statement {ev.correct.length}건 · 오답 Statement {ev.incorrect.length}건 · Statement 없음(무응답) {ev.missing.length}
          {unit}
        </summary>
        {!matches ? (
          <div className="alert alert-warning small">
            <p>근거 건수가 화면 숫자({numerator}/{denominator})와 다릅니다. Statement 파일과 분석 데이터가 어긋났습니다.</p>
          </div>
        ) : null}
        <div className="xapi-ev-list">
          <table className="data">
            <thead>
              <tr><th scope="col">구분</th><th scope="col">학생</th><th scope="col">문항</th><th scope="col">응답</th><th scope="col">Statement</th></tr>
            </thead>
            <tbody>
              {rows.flatMap(([group, list]) =>
                list.map((r) => (
                  <tr key={`${r.attemptId}:${r.itemId}`}>
                    <td className={group === "정답" ? "state-correct" : group === "오답" ? "state-incorrect" : "muted"}>{group}</td>
                    <td>{studentById.get(r.studentId)?.name ?? r.studentId}</td>
                    <td>Q{itemById.get(r.itemId)?.number}</td>
                    <td>{r.statement ? <span className="answer-chip">{r.statement.result?.response}</span> : <span className="muted">–</span>}</td>
                    <td>{r.statement ? <StatementJson s={r.statement} /> : <span className="muted small">answered 없음</span>}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          출처: <a href={statementsUrl(ds.quiz.id)} download>{ds.quiz.id}.statements.json</a> · <Link href="/xapi/">xAPI 기록 전체 보기</Link>
        </p>
      </details>
    </div>
  );
}
