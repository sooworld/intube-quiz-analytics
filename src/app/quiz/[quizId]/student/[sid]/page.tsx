import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentDetail } from "@/components/analysis/StudentDetail";
import { getDataset } from "@/lib/data";

export const dynamicParams = false;

export async function generateStaticParams({ params }: { params: { quizId: string } }) {
  const ds = getDataset(params.quizId);
  return (ds?.students ?? []).map((s) => ({ sid: s.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ quizId: string; sid: string }> }): Promise<Metadata> {
  const { quizId, sid } = await params;
  const name = getDataset(quizId)?.students.find((s) => s.id === sid)?.name;
  return { title: name ? `${name} 학생 상세` : "학생 상세" };
}

export default async function StudentPage({ params }: { params: Promise<{ quizId: string; sid: string }> }) {
  const { quizId, sid } = await params;
  const ds = getDataset(quizId);
  if (!ds || !ds.students.some((s) => s.id === sid)) notFound();
  return <StudentDetail sid={sid} />;
}
