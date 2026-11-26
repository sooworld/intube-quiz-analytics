import { notFound } from "next/navigation";
import { CourseHome } from "@/components/moodle/CourseHome";
import { getCourse, getCourseById, getForum } from "@/lib/data";
import { FORUM_KIND_LABEL } from "@/lib/forum/types";

export const metadata = { title: "한국 현대시 읽기" };

export default function LitCourseHomePage() {
  const course = getCourseById("lit201");
  if (!course) notFound();
  const metas: Record<string, string> = {};
  for (const s of course.sections)
    for (const a of s.activities) {
      const forum = a.href ? getForum(a.id) : null;
      if (forum) metas[a.id] = `${FORUM_KIND_LABEL[forum.forum.kind]} · 글 ${forum.posts.length}개 · 합성 글`;
    }
  const algo = getCourse();
  return (
    <CourseHome
      course={course}
      homeHref="/courses/lit201/"
      metas={metas}
      otherCourses={[{ href: "/courses/", label: `${algo.shortName} ${algo.fullName}` }]}
      notice={
        <p>
          문학 해석형 토론(C형) 데모를 위해 만든 강좌입니다. <strong>3주차 토론</strong>에서 설계 지도와 논의 지도를 열어 보세요. 토론 글은 모두 <strong>합성 글</strong>입니다.
        </p>
      }
    />
  );
}
