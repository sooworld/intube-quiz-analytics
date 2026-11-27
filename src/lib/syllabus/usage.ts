// 계획서 항목 → 그 항목을 "직접" 쓰는 곳 (계획 T3). 순수 함수.
// - 퀴즈 문항: 기본 Q-matrix(문항 데이터의 conceptIds) 기준. 교수가 브라우저에서 고친 태그는 반영하지 않는다.
// - 서술형: 루브릭 기준의 conceptIds.
// - 토론: 목표의 syllabusId.
// 목표→개념→문항처럼 건너뛴 연결은 세지 않는다(계획 반례 11: "f5 O1이 q6을 쓴다"는 거짓 연결이 된다).
import type { ForumDataset } from "../forum/types";
import type { EssayQuizDataset, QuizDataset } from "../types";
import type { Syllabus } from "./types";

export type SyllabusUseKind = "quiz-item" | "essay-criterion" | "forum-objective";

export interface SyllabusUse {
  kind: SyllabusUseKind;
  activityId: string;
  activityName: string;
  /** 활동 안에서 쓰는 곳 (예: "3번 문항", "1번 · 개선 방법 제안", "O1") */
  label: string;
  href: string;
}

export interface UsageSources {
  quizzes: QuizDataset[];
  essays: EssayQuizDataset[];
  forums: ForumDataset[];
}

export function syllabusUsage(syl: Syllabus, src: UsageSources): Record<string, SyllabusUse[]> {
  const out: Record<string, SyllabusUse[]> = {};
  const add = (id: string, use: SyllabusUse) => (out[id] ??= []).push(use);
  for (const { quiz } of src.quizzes) {
    if (quiz.courseId !== syl.courseId) continue;
    for (const it of [...quiz.items].sort((a, b) => a.number - b.number))
      for (const cid of it.conceptIds) add(cid, { kind: "quiz-item", activityId: quiz.id, activityName: quiz.name, label: `${it.number}번 문항`, href: `/quiz/${quiz.id}/qmatrix/` });
  }
  for (const { quiz } of src.essays) {
    if (quiz.courseId !== syl.courseId) continue;
    for (const it of [...quiz.items].sort((a, b) => a.number - b.number))
      for (const c of it.rubric)
        for (const cid of c.conceptIds) add(cid, { kind: "essay-criterion", activityId: quiz.id, activityName: quiz.name, label: `${it.number}번 · ${c.name}`, href: `/essay/${quiz.id}/` });
  }
  for (const f of src.forums) {
    if (f.forum.courseId !== syl.courseId) continue;
    for (const o of f.objectives)
      if (o.syllabusId) add(o.syllabusId, { kind: "forum-objective", activityId: f.forum.id, activityName: f.forum.name, label: o.id, href: `/forum/${f.forum.id}/design/` });
  }
  return out;
}
