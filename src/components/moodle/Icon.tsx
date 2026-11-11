// 간단한 인라인 SVG 아이콘 (외부 아이콘 폰트·자산 미사용)
const PATHS: Record<string, string> = {
  quiz: "M9 11l2 2 4-4M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z",
  page: "M7 3h7l5 5v13H7zM14 3v5h5M9.5 13h6M9.5 17h6",
  assign: "M9 4h6v3H9zM6 6h3M15 6h3v15H6V6M9 12h6M9 16h4",
  forum: "M4 5h16v10H9l-5 4zM8 9h8M8 12h5",
  url: "M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1",
  bell: "M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0",
  chat: "M4 5h16v11H8l-4 4z",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M6 9l6 6 6-6",
  info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 110 18 9 9 0 010-18z",
  check: "M5 12l5 5 9-10",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}

export const ACTIVITY_PURPOSE: Record<string, "assessment" | "content" | "communication" | "collaboration"> = {
  quiz: "assessment",
  assign: "assessment",
  page: "content",
  url: "content",
  forum: "collaboration",
};

export function ActivityIcon({ type, small }: { type: string; small?: boolean }) {
  return (
    <span className={`activity-icon${small ? " sm" : ""}`} data-purpose={ACTIVITY_PURPOSE[type] ?? "content"} aria-hidden="true">
      <Icon name={(type in PATHS ? type : "page") as IconName} size={small ? 18 : 22} />
    </span>
  );
}
