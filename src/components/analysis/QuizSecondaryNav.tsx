"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function QuizSecondaryNav({ quizId }: { quizId: string }) {
  const pathname = (usePathname() ?? "").replace(/\/$/, "");
  const base = `/quiz/${quizId}`;
  const items = [
    { label: "퀴즈 개요", href: `${base}/`, match: (p: string) => p === base },
    { label: "결과 분석", href: `${base}/analysis/`, match: (p: string) => p.startsWith(`${base}/analysis`) || p.startsWith(`${base}/student`) },
    { label: "문제별 개념", href: `${base}/qmatrix/`, match: (p: string) => p.startsWith(`${base}/qmatrix`) },
    { label: "보충 그룹", href: `${base}/groups/`, match: (p: string) => p.startsWith(`${base}/groups`) },
  ];
  return (
    <nav className="secondary-nav" aria-label="퀴즈 메뉴">
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
