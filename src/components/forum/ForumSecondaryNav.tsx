"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ForumSecondaryNav({ forumId }: { forumId: string }) {
  const pathname = (usePathname() ?? "").replace(/\/$/, "");
  const base = `/forum/${forumId}`;
  const items = [
    { label: "토론", href: `${base}/`, match: (p: string) => p === base },
    { label: "설계 지도", href: `${base}/design/`, match: (p: string) => p.startsWith(`${base}/design`) },
    { label: "논의 지도", href: `${base}/map/`, match: (p: string) => p.startsWith(`${base}/map`) },
    { label: "글별 근거", href: `${base}/posts/`, match: (p: string) => p.startsWith(`${base}/posts`) },
    { label: "실연 기록", href: `${base}/live/`, match: (p: string) => p.startsWith(`${base}/live`) },
  ];
  return (
    <nav className="secondary-nav" aria-label="토론 메뉴">
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
