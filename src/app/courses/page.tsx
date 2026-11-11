import Link from "next/link";
import { ActivityIcon } from "@/components/moodle/Icon";
import { PageHeader } from "@/components/moodle/PageParts";
import { getCourse, getDataset, getEssayDataset } from "@/lib/data";
import { formatDateTime } from "@/lib/format";

export default function CourseHome() {
  const course = getCourse();
  const quizMeta = (id: string) => {
    const essay = getEssayDataset(id);
    if (essay) return `서술형 ${essay.quiz.items.length}문항 · 제출 ${essay.submissions.length}건 · AI 채점 제안`;
    const ds = getDataset(id);
    if (!ds) return null;
    const finished = ds.attempts.filter((a) => a.status === "finished").length;
    return `마감: ${formatDateTime(ds.quiz.closeDate)} · 응시 ${finished}/${ds.students.length}명`;
  };
  return (
    <div className="page">
      <PageHeader title={course.fullName} crumbs={[{ label: "My courses" }, { label: course.shortName }]} />
      <nav className="secondary-nav" aria-label="과정 메뉴">
        <ul>
          <li><Link href="/courses/" aria-current="page">Course</Link></li>
          <li><span className="tab-btn muted" title="데모에서는 열리지 않음">Participants</span></li>
          <li><span className="tab-btn muted" title="데모에서는 열리지 않음">Grades</span></li>
          <li><span className="tab-btn muted" title="데모에서는 열리지 않음">Reports</span></li>
          <li><Link href="/xapi/">xAPI 기록</Link></li>
        </ul>
      </nav>
      <div className="alert alert-info">
        <p>
          이 데모에서 열 수 있는 활동은 <strong>5주차 퀴즈</strong>와 <strong>5주차 서술형 퀴즈</strong>입니다. 퀴즈 화면에서 <strong>분석 보기</strong>를,
          서술형 퀴즈에서 <strong>채점 화면</strong>을 열어 보세요.
        </p>
        <p>
          5주차 퀴즈의 분석은 xAPI Statement 파일에서 계산합니다. 원문과 검증 보고서는 <Link href="/xapi/">xAPI 기록</Link>에서 볼 수 있습니다.
        </p>
      </div>
      {course.sections.map((s) => (
        <section key={s.number} className="course-section" aria-labelledby={`sec-${s.number}`}>
          <h2 id={`sec-${s.number}`}>{s.title}</h2>
          {s.summary ? <p className="muted">{s.summary}</p> : null}
          <ul className="activity-list">
            {s.activities.map((a) => (
              <li key={a.id} className={`activity-item${a.href ? " is-demo" : ""}`}>
                <ActivityIcon type={a.type} small />
                <div>
                  {a.href ? (
                    <Link className="activity-name" href={a.href}>{a.name}</Link>
                  ) : (
                    <span className="activity-name">{a.name}</span>
                  )}
                  <div className="activity-meta">
                    {a.href ? (quizMeta(a.id) ?? "") : "데모에서는 열리지 않는 활동"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
