import Link from "next/link";
import { CourseHome } from "@/components/moodle/CourseHome";
import { getCourse, getCourseById, getDataset, getEssayDataset, getForum } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { FORUM_KIND_LABEL } from "@/lib/forum/types";

export default function CourseHomePage() {
  const course = getCourse();
  const metas: Record<string, string> = {};
  for (const s of course.sections)
    for (const a of s.activities) {
      if (!a.href) continue;
      const essay = getEssayDataset(a.id);
      const ds = getDataset(a.id);
      const forum = getForum(a.id);
      if (essay) metas[a.id] = `서술형 ${essay.quiz.items.length}문항 · 제출 ${essay.submissions.length}건 · AI 채점 제안`;
      else if (ds) metas[a.id] = `마감: ${formatDateTime(ds.quiz.closeDate)} · 응시 ${ds.attempts.filter((x) => x.status === "finished").length}/${ds.students.length}명`;
      else if (forum) metas[a.id] = `${FORUM_KIND_LABEL[forum.forum.kind]} · 글 ${forum.posts.length}개 · 합성 글`;
    }
  const lit = getCourseById("lit201");
  return (
    <CourseHome
      course={course}
      homeHref="/courses/"
      metas={metas}
      extraTabs={<li><Link href="/xapi/">xAPI 기록</Link></li>}
      otherCourses={lit ? [{ href: "/courses/lit201/", label: `${lit.shortName} ${lit.fullName}` }] : []}
      notice={
        <>
          <p>
            이 데모에서 열 수 있는 활동은 <strong>5주차 퀴즈</strong>, <strong>5주차 서술형 퀴즈</strong>, <strong>5주차 토론</strong>입니다. 퀴즈 화면에서 <strong>분석 보기</strong>를,
            서술형 퀴즈에서 <strong>채점 화면</strong>을, 토론에서 <strong>설계 지도</strong>와 <strong>논의 지도</strong>를 열어 보세요.
          </p>
          <p>
            5주차 퀴즈의 분석은 xAPI Statement 파일에서 계산합니다. 원문과 검증 보고서는 <Link href="/xapi/">xAPI 기록</Link>에서 볼 수 있습니다.
          </p>
        </>
      }
    />
  );
}
