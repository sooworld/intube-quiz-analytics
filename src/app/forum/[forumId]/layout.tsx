import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ForumSecondaryNav } from "@/components/forum/ForumSecondaryNav";
import { PageHeader } from "@/components/moodle/PageParts";
import { courseHomeHref } from "@/lib/syllabus/resolve";
import { forumIds, getCourseById, getForum } from "@/lib/data";
import { ForumProvider } from "@/lib/state/ForumContext";

export const dynamicParams = false;

export function generateStaticParams() {
  return forumIds().map((forumId) => ({ forumId }));
}

export default async function ForumLayout({ children, params }: { children: ReactNode; params: Promise<{ forumId: string }> }) {
  const { forumId } = await params;
  const ds = getForum(forumId);
  if (!ds) notFound();
  const course = getCourseById(ds.forum.courseId);
  const home = courseHomeHref(course?.id ?? ds.forum.courseId);
  const section = course?.sections.find((s) => s.number === ds.forum.sectionNumber);
  return (
    <div className="page">
      <PageHeader
        title={ds.forum.name}
        activityType="forum"
        crumbs={[
          { label: "My courses" },
          { label: course?.shortName ?? "", href: home },
          { label: section?.title ?? "", href: `${home}#sec-${ds.forum.sectionNumber}` },
          { label: ds.forum.name },
        ]}
      />
      <ForumSecondaryNav forumId={forumId} />
      <p className="forum-provenance">
        <span className="badge badge-demo">합성 글</span>
        <span>설계자가 쓴 가상 토론으로 만든 <strong>인터페이스 시연</strong>입니다. 도구의 성능은 검증 전입니다.</span>
      </p>
      <ForumProvider dataset={ds}>{children}</ForumProvider>
    </div>
  );
}
