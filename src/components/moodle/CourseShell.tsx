"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Course } from "@/lib/types";
import { Icon } from "./Icon";

const MOBILE = "(max-width: 760px)";

export function CourseShell({ course, children }: { course: Course; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(course.sections.map((s) => [s.number, s.number === 5])),
  );
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);

  // 화면 폭은 마운트 후에 확인한다 (정적 HTML과 hydration 결과를 맞추기 위해)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE);
    const apply = () => {
      setIsMobile(mq.matches);
      if (mq.matches) setOpen(false);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // 초점 이동: 열면 닫기 버튼으로, 닫으면 여는 버튼으로 돌려준다
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (open) closeRef.current?.focus();
    else toggleRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isMobile]);

  const isCurrent = (href?: string) => !!href && pathname.startsWith(href.replace(/\/$/, ""));

  return (
    <div className={`course-shell${open ? "" : " drawer-closed"}`}>
      {!open && (
        <button ref={toggleRef} type="button" className="drawer-toggle-floating" aria-label="과정 인덱스 열기" aria-expanded={false} aria-controls="course-index-drawer" onClick={() => setOpen(true)}>
          <Icon name="menu" />
        </button>
      )}
      <aside id="course-index-drawer" className="drawer" hidden={!open} aria-label="과정 인덱스">
        <div className="drawer-head">
          <h2>Course index</h2>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="과정 인덱스 닫기" aria-expanded={true} aria-controls="course-index-drawer" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <ul className="course-index">
          {course.sections.map((s) => {
            const isOpen = expanded[s.number] ?? false;
            const listId = `ci-section-${s.number}`;
            return (
              <li key={s.number} className="course-index-section">
                <button type="button" aria-expanded={isOpen} aria-controls={listId} onClick={() => setExpanded((e) => ({ ...e, [s.number]: !isOpen }))}>
                  <span className="chevron" data-open={isOpen}><Icon name="chevron" size={16} /></span>
                  {s.title}
                </button>
                <ul id={listId} hidden={!isOpen}>
                  {s.activities.map((a) => (
                    <li key={a.id}>
                      {a.href ? (
                        <Link href={a.href} aria-current={isCurrent(a.href) ? "page" : undefined} onClick={() => { if (isMobile) setOpen(false); }}>{a.name}</Link>
                      ) : (
                        <span title="데모에서는 열리지 않는 활동">{a.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="main-region">{children}</div>
    </div>
  );
}
