import Link from "next/link";
import type { ReactNode } from "react";
import { getSyllabus } from "@/lib/syllabus/registry";
import { syllabusHref, syllabusWeekHref } from "@/lib/syllabus/resolve";
import type { Course } from "@/lib/types";
import { ActivityIcon } from "./Icon";
import { PageHeader } from "./PageParts";

/** 강좌 첫 화면 (Moodle 강좌 페이지 근사). 활동 메타 문구는 페이지가 서버에서 계산해 넘긴다 */
export function CourseHome({
  course,
  homeHref,
  metas,
  notice,
  extraTabs,
  otherCourses,
}: {
  course: Course;
  homeHref: string;
  metas: Record<string, string>;
  notice: ReactNode;
  extraTabs?: ReactNode;
  otherCourses: { href: string; label: string }[];
}) {
  const syl = getSyllabus(course.id);
  return (
    <div className="page">
      <PageHeader title={course.fullName} crumbs={[{ label: "My courses" }, { label: course.shortName }]} />
      <nav className="secondary-nav" aria-label="과정 메뉴">
        <ul>
          <li><Link href={homeHref} aria-current="page">Course</Link></li>
          {syl ? <li><Link href={syllabusHref(course.id)}>강의계획서</Link></li> : null}
          <li><span className="tab-btn muted" title="데모에서는 열리지 않음">Participants</span></li>
          <li><span className="tab-btn muted" title="데모에서는 열리지 않음">Grades</span></li>
          <li><span className="tab-btn muted" title="데모에서는 열리지 않음">Reports</span></li>
          {extraTabs}
        </ul>
      </nav>
      <div className="alert alert-info">
        {notice}
        {otherCourses.length > 0 ? (
          <p className="small">
            다른 강좌:{" "}
            {otherCourses.map((c, i) => (
              <span key={c.href}>
                {i > 0 ? " · " : ""}
                <Link href={c.href}>{c.label}</Link>
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {course.sections.map((s) => (
        <section key={s.number} className="course-section" aria-labelledby={`sec-${s.number}`}>
          <div className="course-section-head">
            <h2 id={`sec-${s.number}`}>{s.title}</h2>
            {syl?.weeks.some((w) => w.week === s.number) ? (
              <Link className="small" href={syllabusWeekHref(course.id, s.number)} aria-label={`강의계획서 ${s.number}주차`}>
                계획서
              </Link>
            ) : null}
          </div>
          {s.summary ? <p className="muted">{s.summary}</p> : null}
          <ul className="activity-list">
            {s.activities.map((a) => (
              <li key={a.id} className={`activity-item${a.href ? " is-demo" : ""}`}>
                <ActivityIcon type={a.type} small />
                <div>
                  {a.href ? <Link className="activity-name" href={a.href}>{a.name}</Link> : <span className="activity-name">{a.name}</span>}
                  <div className="activity-meta">{a.href ? (metas[a.id] ?? "") : "데모에서는 열리지 않는 활동"}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
