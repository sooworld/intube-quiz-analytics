"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { loadStatements } from "@/lib/xapi/load";
import { itemIri, VERB, VERB_DISPLAY, type XStatement } from "@/lib/xapi/vocab";
import { StatementJson } from "./StatementJson";

interface Props {
  quizId: string;
  courseId: string;
  items: { id: string; number: number }[];
  students: { id: string; name: string }[];
}

const verbKeyOf = new Map<string, keyof typeof VERB>(Object.entries(VERB).map(([k, iri]) => [iri, k as keyof typeof VERB]));

/** Statement 목록: 동사·문항·학생 필터와 원문 펼치기 */
export function StatementBrowser({ quizId, courseId, items, students }: Props) {
  const [statements, setStatements] = useState<XStatement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verb, setVerb] = useState("");
  const [item, setItem] = useState("");
  const [student, setStudent] = useState("");

  useEffect(() => {
    loadStatements(quizId).then(setStatements, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [quizId]);

  const itemByIri = useMemo(() => new Map(items.map((it) => [itemIri(courseId, quizId, it.id), it])), [items, courseId, quizId]);
  const nameOf = useMemo(() => new Map(students.map((s) => [s.id, s.name])), [students]);

  const filtered = useMemo(
    () =>
      (statements ?? []).filter(
        (s) =>
          (!verb || s.verb.id === verb) &&
          (!item || s.object.id === itemIri(courseId, quizId, item)) &&
          (!student || s.actor.account.name === student),
      ),
    [statements, verb, item, student, courseId, quizId],
  );

  if (error) return <div className="alert alert-warning"><p>{error}</p></div>;
  if (!statements) return <p className="muted">Statement 파일을 받는 중…</p>;

  const verbsPresent = [...new Set(statements.map((s) => s.verb.id))];

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <label className="small">동사{" "}
          <select value={verb} onChange={(e) => setVerb(e.target.value)}>
            <option value="">전체</option>
            {verbsPresent.map((v) => {
              const k = verbKeyOf.get(v);
              return <option key={v} value={v}>{k ? `${k} (${VERB_DISPLAY[k]})` : v}</option>;
            })}
          </select>
        </label>
        <label className="small">문항{" "}
          <select value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">전체</option>
            {items.map((it) => <option key={it.id} value={it.id}>Q{it.number}</option>)}
          </select>
        </label>
        <label className="small">학생{" "}
          <select value={student} onChange={(e) => setStudent(e.target.value)}>
            <option value="">전체</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
          </select>
        </label>
        <span className="small muted" aria-live="polite">{filtered.length} / {statements.length}건</span>
      </div>
      <div className="table-wrap xapi-list">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">시각</th><th scope="col">학생</th><th scope="col">동사</th><th scope="col">대상</th><th scope="col">결과</th><th scope="col">원문</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const k = verbKeyOf.get(s.verb.id);
              const it = itemByIri.get(s.object.id);
              const sid = s.actor.account.name;
              const r = s.result;
              return (
                <tr key={s.id}>
                  <td className="small">{s.timestamp ? formatDateTime(s.timestamp) : "–"}</td>
                  <td>{nameOf.get(sid) ?? sid} <span className="muted small">{sid}</span></td>
                  <td>{k ?? s.verb.id}</td>
                  <td>{it ? `Q${it.number}` : <span className="small">퀴즈</span>}</td>
                  <td>
                    {r?.response !== undefined ? <span className="answer-chip">{r.response}</span> : null}{" "}
                    {r?.success !== undefined ? (
                      <span className={r.success ? "state-correct" : "state-incorrect"}>{r.success ? "정답" : "오답"}</span>
                    ) : null}
                  </td>
                  <td><StatementJson s={s} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
