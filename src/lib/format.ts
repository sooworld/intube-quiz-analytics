// 표시 형식 도우미. 날짜는 서버·클라이언트 모두 같은 결과가 나오도록 Asia/Seoul로 고정한다.
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 0~1 비율을 정수 %로. null이면 "자료 없음" */
export function pct(v: number | null): string {
  return v === null ? "자료 없음" : `${Math.round(v * 100)}%`;
}

/** "3/4" 같은 분수 표기 */
export function frac(n: number, d: number): string {
  return `${n}/${d}`;
}
