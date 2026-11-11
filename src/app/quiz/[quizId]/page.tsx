import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityNav } from "@/components/moodle/PageParts";
import { totalScore } from "@/lib/analysis/itemStats";
import { buildMatrix } from "@/lib/analysis/matrix";
import { getDataset } from "@/lib/data";
import { formatDateTime } from "@/lib/format";

export default async function QuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const ds = getDataset(quizId);
  if (!ds) notFound();
  const m = buildMatrix(ds);
  const scores = m.students.map((s) => totalScore(m, s.id));
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const mcq = ds.quiz.items.filter((i) => i.type === "mcq").length;
  const short = ds.quiz.items.length - mcq;

  return (
    <>
      <p>{ds.quiz.intro}</p>
      <dl className="grid-4" style={{ margin: "1rem 0" }}>
        <div className="stat-tile"><dt className="label">마감</dt><dd className="value" style={{ fontSize: "var(--fs-lg)", margin: 0 }}>{formatDateTime(ds.quiz.closeDate)}</dd></div>
        <div className="stat-tile"><dt className="label">문항</dt><dd className="value" style={{ margin: 0 }}>{ds.quiz.items.length}</dd><dd className="detail" style={{ margin: 0 }}>객관식 {mcq} · 단답 {short}</dd></div>
        <div className="stat-tile"><dt className="label">응시 완료</dt><dd className="value" style={{ margin: 0 }}>{m.students.length}명</dd><dd className="detail" style={{ margin: 0 }}>미응시 {m.notAttempted.length}명</dd></div>
        <div className="stat-tile"><dt className="label">평균 점수</dt><dd className="value" style={{ margin: 0 }}>{mean === null ? "–" : mean.toFixed(1)}</dd><dd className="detail" style={{ margin: 0 }}>{ds.quiz.items.length}점 만점</dd></div>
      </dl>
      <div className="card">
        <h2 className="card-title">교수용 분석</h2>
        <p className="card-sub">개념별 관찰 오답률, 문항분석, 동시 오답 패턴을 확인하고 보충 그룹을 검토합니다.</p>
        <div className="btn-row">
          <Link className="btn btn-primary" href={`/quiz/${quizId}/analysis/`}>분석 보기</Link>
          <Link className="btn btn-outline" href={`/quiz/${quizId}/qmatrix/`}>문제별 개념 확인</Link>
        </div>
      </div>
      <ActivityNav prev={{ label: "과정 홈 · 5주차", href: `/courses/#sec-${ds.quiz.sectionNumber}` }} />
    </>
  );
}
