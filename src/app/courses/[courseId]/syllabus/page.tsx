// 강의계획서 페이지 (docs/decisions.md U19). 정적 내보내기라 계획서가 있는 강좌만 미리 만든다(dynamicParams=false).
import Link from "next/link";
import { notFound } from "next/navigation";
import { SyllabusView } from "@/components/syllabus/SyllabusView";
import { essayQuizIds, forumIds, getCourseById, getDataset, getEssayDataset, getForum, quizIds } from "@/lib/data";
import { getSyllabus, syllabusCourseIds } from "@/lib/syllabus/registry";
import { DEFAULT_COURSE_ID } from "@/lib/syllabus/resolve";
import { syllabusUsage } from "@/lib/syllabus/usage";

export const dynamicParams = false;

export function generateStaticParams() {
  return syllabusCourseIds().map((courseId) => ({ courseId }));
}

export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const course = getCourseById(courseId);
  return { title: course ? `강의계획서 · ${course.shortName}` : "강의계획서" };
}

export default async function SyllabusPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const syl = getSyllabus(courseId);
  const course = getCourseById(courseId);
  if (!syl || !course) notFound();
  const usage = syllabusUsage(syl, {
    quizzes: quizIds().map((id) => getDataset(id)!),
    essays: essayQuizIds().map((id) => getEssayDataset(id)!),
    forums: forumIds().map((id) => getForum(id)!),
  });
  return <SyllabusView syl={syl} course={course} usage={usage} extraTabs={courseId === DEFAULT_COURSE_ID ? <li><Link href="/xapi/">xAPI 기록</Link></li> : null} />;
}
