"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Course } from "@/lib/types";
import { CourseShell } from "./CourseShell";

/** 소개 페이지(`/`)는 상단바·과정 인덱스 없이 본문만 보여 주고, 나머지 화면은 Moodle 틀 안에 넣는다. */
export function AppChrome({ navbar, footer, course, children }: { navbar: ReactNode; footer: ReactNode; course: Course; children: ReactNode }) {
  const body = (
    <>
      <main id="main" tabIndex={-1}>{children}</main>
      {footer}
    </>
  );
  if (usePathname() === "/") return body;
  return (
    <>
      {navbar}
      <CourseShell course={course}>{body}</CourseShell>
    </>
  );
}
