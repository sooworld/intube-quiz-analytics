"use client";

import { usePathname } from "next/navigation";

/**
 * 하단 해석 안내. 오답률이 나오는 퀴즈 화면에만 붙인다. 결과 분석 화면은 상단 안내에 같은 말이 있어 빼고,
 * 서술형·설정 화면에는 오답률이 없어 붙이지 않는다(decisions U13: 같은 말은 한 번만).
 */
export function QuizFooterNote() {
  const path = usePathname() ?? "";
  if (!path.startsWith("/quiz/") || path.includes("/analysis")) return null;
  return <p className="small">분석 수치는 관찰된 오답 비율이며, 개념 숙달 여부를 확정하지 않습니다.</p>;
}
