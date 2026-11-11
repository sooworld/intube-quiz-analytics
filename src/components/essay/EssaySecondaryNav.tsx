"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function EssaySecondaryNav({ quizId }: { quizId: string }) {
  const pathname = (usePathname() ?? "").replace(/\/$/, "");
  const base = `/essay/${quizId}`;
  const items = [
    { label: "퀴즈 개요", href: `${base}/`, match: (p: string) => p === base },
    { label: "채점 (AI 제안)", href: `${base}/grading/`, match: (p: string) => p.startsWith(`${base}/grading`) },
    { label: "결과 분석", href: `${base}/analysis/`, match: (p: string) => p.startsWith(`${base}/analysis`) },
  ];
  // AI 설정은 상단 막대의 "AI 설정" 버튼으로 간다(같은 이동을 탭에 다시 두지 않음, decisions U13)
  return (
    <nav className="secondary-nav" aria-label="서술형 퀴즈 메뉴">
      <ul>
        {items.map((it) => (
          <li key={it.href}>
            <Link href={it.href} aria-current={it.match(pathname) ? "page" : undefined}>{it.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
