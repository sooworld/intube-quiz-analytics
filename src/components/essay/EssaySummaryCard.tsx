"use client";
// 서술형 결과 요약 초안 (docs/decisions.md §6, §8.4). 확정한 점수로만 사실을 만들고, 요약 작업·검증기는 객관식과 같다.
import { useMemo } from "react";
import { SummaryDraftPanel } from "@/components/analysis/SummaryDraftCard";
import { buildEssayFacts, hasFinals } from "@/lib/essay/facts";
import { useEssay } from "@/lib/state/EssayContext";

export function EssaySummaryCard() {
  const { ds, grades, drafts, addDraft, summaryFinal, saveSummaryFinal, clearSummaryFinal } = useEssay();
  const facts = useMemo(() => buildEssayFacts(ds, grades), [ds, grades]);
  const anyFinal = hasFinals(ds, grades);
  return (
    <SummaryDraftPanel
      quizId={ds.quiz.id}
      dataVersion={ds.dataVersion}
      facts={facts}
      factsLabel="코드 계산, 교수가 확정한 점수만"
      drafts={drafts}
      addDraft={addDraft}
      summaryFinal={summaryFinal}
      saveSummaryFinal={saveSummaryFinal}
      clearSummaryFinal={clearSummaryFinal}
      blockedReason={anyFinal ? null : "확정한 답안이 아직 없어 요약할 수 없습니다. 확정 전 점수(AI 제안)는 요약에 쓰지 않습니다."}
    />
  );
}
