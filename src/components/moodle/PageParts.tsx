import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityIcon, Icon } from "./Icon";

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({ title, crumbs, activityType, children }: { title: string; crumbs: Crumb[]; activityType?: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <nav aria-label="이동 경로">
        <ol className="breadcrumb">
          {crumbs.map((c, i) => (
            <li key={i}>{c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
          ))}
        </ol>
      </nav>
      <div className="activity-header">
        {activityType ? <ActivityIcon type={activityType} /> : null}
        <div>
          {activityType ? <div className="small muted">{activityType === "quiz" ? "Quiz" : activityType}</div> : null}
          <h1>{title}</h1>
        </div>
      </div>
      {children}
    </div>
  );
}

export interface NavLink {
  label: string;
  href: string;
}

/** 이전/다음 활동 내비게이션 (5.3 선형 내비게이션 근사) */
export function ActivityNav({ prev, next }: { prev?: NavLink; next?: NavLink }) {
  return (
    <nav className="activity-nav" aria-label="활동 이동">
      <div>
        {prev ? (
          <Link href={prev.href}>
            <span className="dir"><Icon name="left" size={12} /> 이전</span>
            {prev.label}
          </Link>
        ) : null}
      </div>
      <div style={{ textAlign: "right" }}>
        {next ? (
          <Link href={next.href}>
            <span className="dir">다음 <Icon name="right" size={12} /></span>
            {next.label}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function CaveatNote({ children }: { children: ReactNode }) {
  return (
    <p className="caveat">
      <Icon name="info" size={16} />
      <span>{children}</span>
    </p>
  );
}
