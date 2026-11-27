import Link from "next/link";
import { notFound } from "next/navigation";
import { InfoTip } from "@/components/moodle/InfoTip";
import { ActivityNav } from "@/components/moodle/PageParts";
import { SyllabusRef } from "@/components/syllabus/SyllabusRef";
import { getDataset, getEssayDataset } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { getSyllabus } from "@/lib/syllabus/registry";
import { syllabusHref, syllabusItem } from "@/lib/syllabus/resolve";

export default async function EssayQuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const ds = getEssayDataset(quizId);
  if (!ds) notFound();
  const finished = ds.attempts.filter((a) => a.status === "finished").length;
  const empty = ds.submissions.filter((s) => s.text === null).length;
  const conceptName = new Map(ds.quiz.concepts.map((c) => [c.id, c.name]));
  // 루브릭 기준이 가리키는 계획서 개념 (퀴즈 개념 순서로)
  const syl = getSyllabus(ds.quiz.courseId);
  const used = new Set(ds.quiz.items.flatMap((it) => it.rubric.flatMap((c) => c.conceptIds)));
  const sylItems = syl ? ds.quiz.concepts.filter((c) => used.has(c.id)).map((c) => syllabusItem(syl, c.id)).filter((x) => x !== null) : [];
  const conceptRef = (id: string) => {
    const si = syl ? syllabusItem(syl, id) : null;
    return si ? <SyllabusRef key={id} courseId={ds.quiz.courseId} item={si}>{conceptName.get(id) ?? id}</SyllabusRef> : <span key={id}>{conceptName.get(id) ?? id}</span>;
  };
  // 이전 활동은 같은 주차의 객관식 퀴즈다. 제목은 데이터에서 읽는다(재생성으로 제목이 바뀌어도 맞게)
  const prevQuiz = getDataset("quiz-w5");
  return (
    <>
      <p>{ds.quiz.intro}</p>
      {sylItems.length > 0 ? (
        <p className="small">
          이 퀴즈가 다루는 계획서 항목:{" "}
          {sylItems.map((si, i) => (
            <span key={si.id}>
              {i > 0 ? " · " : ""}
              {conceptRef(si.id)}
            </span>
          ))}{" "}
          <Link className="muted" href={syllabusHref(ds.quiz.courseId)}>강의계획서 전체</Link>
        </p>
      ) : null}
      <dl className="grid-4" style={{ margin: "1rem 0" }}>
        <div className="stat-tile"><dt className="label">마감</dt><dd className="value" style={{ fontSize: "var(--fs-lg)", margin: 0 }}>{formatDateTime(ds.quiz.closeDate)}</dd></div>
        <div className="stat-tile"><dt className="label">문항</dt><dd className="value" style={{ margin: 0 }}>{ds.quiz.items.length}</dd><dd className="detail" style={{ margin: 0 }}>서술형 · 문항당 {ds.quiz.items[0]?.maxScore}점</dd></div>
        <div className="stat-tile"><dt className="label">응시 완료</dt><dd className="value" style={{ margin: 0 }}>{finished}명</dd><dd className="detail" style={{ margin: 0 }}>미응시 {ds.attempts.length - finished}명</dd></div>
        <div className="stat-tile"><dt className="label">제출</dt><dd className="value" style={{ margin: 0 }}>{ds.submissions.length}건</dd><dd className="detail" style={{ margin: 0 }}>무응답 {empty}건 포함</dd></div>
      </dl>

      <div className="card">
        <h2 className="card-title">
          채점
          <InfoTip label="채점">
            <span>AI는 루브릭 기준별 수준과 근거 문장, 피드백 초안을 <strong>제안</strong>만 합니다. 교수가 수락하거나 고쳐야 점수가 확정됩니다.</span>
          </InfoTip>
        </h2>
        <div className="btn-row">
          <Link className="btn btn-primary" href={`/essay/${quizId}/grading/`}>채점 화면으로</Link>
        </div>
      </div>

      {ds.quiz.items.map((item) => (
        <section key={item.id} className="card" aria-labelledby={`stem-${item.id}`}>
          <h2 className="card-title" id={`stem-${item.id}`}>문항 {item.number} <span className="small muted">({item.maxScore}점 · {item.charLimit}자 이내)</span></h2>
          <p>{item.stem}</p>
          {item.context ? <p className="muted small">자료 조건: {item.context}</p> : null}
          {/* 루브릭 원문은 접어 둔다(채점 화면의 수정·직접 채점에서 수준 설명을 다시 보여 준다, decisions U13) */}
          <details className="rubric-details">
            <summary className="small">루브릭 기준 {item.rubric.length}개 보기</summary>
            <div className="table-wrap">
              <table className="data rubric">
                <caption className="visually-hidden">문항 {item.number} 루브릭</caption>
                <thead>
                  <tr><th scope="col">기준</th><th scope="col">개념</th><th scope="col">0 미흡</th><th scope="col">1 부분</th><th scope="col">2 충족</th></tr>
                </thead>
                <tbody>
                  {item.rubric.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">{c.name}</th>
                      <td>
                        {c.conceptIds.map((id, i) => (
                          <span key={id}>
                            {i > 0 ? ", " : ""}
                            {conceptRef(id)}
                          </span>
                        ))}
                      </td>
                      {c.levels.map((l) => <td key={l.level}>{l.descriptor}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      ))}
      {prevQuiz ? <ActivityNav prev={{ label: prevQuiz.quiz.name, href: `/quiz/${prevQuiz.quiz.id}/` }} /> : null}
    </>
  );
}
