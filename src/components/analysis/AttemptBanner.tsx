"use client";
// 응시 현황 배너 (docs/decisions.md §8.1 U9). 마감 전에도 분석·AI 초안을 볼 수 있지만 수치가 바뀔 수 있음을 알린다.
import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { useQuiz } from "@/lib/state/QuizContext";

export function AttemptBanner() {
  const { ds, m } = useQuiz();
  // 정적 HTML과 맞추기 위해 현재 시각은 마운트 후에 읽는다
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(Date.now() < new Date(ds.quiz.closeDate).getTime());
  }, [ds.quiz.closeDate]);
  const total = m.students.length + m.notAttempted.length;
  return (
    <p className="small" role="status" style={{ margin: "0 0 0.75rem" }}>
      <span className={`badge ${open ? "badge-demo" : "badge-ok"}`}>{open === null ? "응시 현황" : open ? "마감 전" : "마감됨"}</span> 응시 완료 {m.students.length}/{total}명 · 마감 {formatDateTime(ds.quiz.closeDate)}
      {open ? " · 응시가 끝나지 않아 수치가 바뀔 수 있습니다. 코드 분석은 화면을 열 때마다 다시 계산되고, AI 초안은 버튼을 눌러야 새로 만들어집니다." : ""}
    </p>
  );
}
