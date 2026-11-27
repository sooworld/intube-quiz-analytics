import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { QuizSecondaryNav } from "@/components/analysis/QuizSecondaryNav";
import { PageHeader } from "@/components/moodle/PageParts";
import { courseHomeHref, sectionHref } from "@/lib/syllabus/resolve";
import { getCourse, getCourseById, getDataset, quizIds } from "@/lib/data";
import { QuizProvider } from "@/lib/state/QuizContext";

export const dynamicParams = false;

export function generateStaticParams() {
  return quizIds().map((quizId) => ({ quizId }));
}

export default async function QuizLayout({ children, params }: { children: ReactNode; params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const ds = getDataset(quizId);
  if (!ds) notFound();
  // 퀴즈가 속한 강좌. 없으면 기본 강좌(ALGO101)
  const course = getCourseById(ds.quiz.courseId) ?? getCourse();
  const section = course.sections.find((s) => s.number === ds.quiz.sectionNumber);
  return (
    <div className="page">
      <PageHeader
        title={ds.quiz.name}
        activityType="quiz"
        crumbs={[
          { label: "My courses" },
          { label: course.shortName, href: courseHomeHref(course.id) },
          { label: section?.title ?? "", href: sectionHref(course.id, ds.quiz.sectionNumber) },
          { label: ds.quiz.name },
        ]}
      />
      <QuizSecondaryNav quizId={quizId} />
      <QuizProvider dataset={ds}>{children}</QuizProvider>
    </div>
  );
}
