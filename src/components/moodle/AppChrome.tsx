"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Course } from "@/lib/types";
import { CourseShell } from "./CourseShell";
import { Navbar } from "./Navbar";

/**
 * 지금 경로가 속한 강좌. `/courses/<id>/` 또는 그 강좌 활동의 href로 시작하면 그 강좌, 아니면 첫 강좌(ALGO101).
 * 토론 C형 데모(LIT201)의 과정 인덱스·교수 이름이 ALGO101로 보이지 않게 한다.
 */
export function courseForPath(courses: Course[], pathname: string): Course {
  const hit = courses.find(
    (c) => pathname.startsWith(`/courses/${c.id}/`) || c.sections.some((s) => s.activities.some((a) => a.href && pathname.startsWith(a.href.replace(/\/$/, "")))),
  );
  return hit ?? courses[0]!;
}

/** 소개 페이지(`/`)는 상단바·과정 인덱스 없이 본문만 보여 주고, 나머지 화면은 Moodle 틀 안에 넣는다. */
export function AppChrome({ footer, courses, children }: { footer: ReactNode; courses: Course[]; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const body = (
    <>
      <main id="main" tabIndex={-1}>{children}</main>
      {footer}
    </>
  );
  if (pathname === "/") return body;
  const course = courseForPath(courses, pathname);
  return (
    <>
      <Navbar teacher={course.teacher} />
      <CourseShell key={course.id} course={course}>{body}</CourseShell>
    </>
  );
}
