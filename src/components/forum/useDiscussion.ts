"use client";
// 논의 지도·글별 근거 화면이 함께 쓰는 계산: 어휘 단서, 최신 프로필 초안, 최종 배정, 집계, 표현 중복 후보, 첨언용 사실.
import { useMemo } from "react";
import { forumProfileBasis } from "@/lib/ai/tasks/forumProfile";
import { aggregate, designGaps, isComplete, overlapCandidates } from "@/lib/forum/analysis";
import { buildForumFacts } from "@/lib/forum/facts";
import { postHints, profileInput } from "@/lib/forum/inputs";
import { finalAssignments, sourceMix } from "@/lib/forum/state";
import { useForum } from "@/lib/state/ForumContext";

export function useDiscussion() {
  const f = useForum();
  const { ds } = f;
  const hints = useMemo(() => postHints(ds), [ds]);
  const input = useMemo(() => profileInput(ds, hints), [ds, hints]);
  const basis = useMemo(() => forumProfileBasis(input), [input]);
  const overlaps = useMemo(() => overlapCandidates(ds), [ds]);
  const profile = f.latestProfile && f.latestProfile.basisHash === basis ? f.latestProfile : null;
  const finals = useMemo(() => finalAssignments(ds, profile?.result.posts ?? null, f.assignments.decisions), [ds, profile, f.assignments.decisions]);
  const agg = useMemo(() => aggregate(ds, finals), [ds, finals]);
  const mix = useMemo(() => sourceMix(finals), [finals]);
  const cells = f.checklist.cells;
  // 체크표의 모든 칸을 판정했을 때만 첨언 사실에 넣는다(미검토 칸을 무관으로 읽지 않음)
  const teacherGaps = useMemo(() => (isComplete(ds, cells) ? designGaps(ds, cells).uncoveredObjectives : null), [ds, cells]);
  const facts = useMemo(() => buildForumFacts(ds, { agg, source: mix, overlapPairs: overlaps.length, teacherGaps }), [ds, agg, mix, overlaps.length, teacherGaps]);
  return { ...f, hints, input, basis, profile, staleProfile: !!f.latestProfile && !profile, finals, agg, mix, overlaps, facts };
}
