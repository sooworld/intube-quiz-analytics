// 토론 AI 작업의 입력을 데이터에서 만든다 (순수 함수). 어휘 단서(TF-IDF)는 브라우저에서 계산한다(키 불필요).
import type { ForumDesignInput } from "../ai/tasks/forumDesign";
import type { ForumProfileInput } from "../ai/tasks/forumProfile";
import { fitForum, lexicalCandidates, parentOverlaps } from "./analysis";
import type { PostHint } from "./mockRules";
import type { ForumDataset } from "./types";

export function designInput(ds: ForumDataset): ForumDesignInput {
  return {
    forumId: ds.forum.id,
    objectives: ds.objectives,
    subQuestions: ds.subQuestions.map((q) => ({ id: q.id, text: q.text })),
    intro: ds.forum.intro,
  };
}

export function postHints(ds: ForumDataset): Record<string, PostHint> {
  const cands = lexicalCandidates(ds, fitForum(ds));
  const ov = parentOverlaps(ds);
  return Object.fromEntries(ds.posts.map((p) => [p.id, { candidates: cands[p.id] ?? [], parentOverlap: ov[p.id] ?? null }]));
}

export function profileInput(ds: ForumDataset, hints: Record<string, PostHint> = postHints(ds)): ForumProfileInput {
  return {
    forumId: ds.forum.id,
    kind: ds.forum.kind,
    topic: ds.forum.topic,
    subQuestions: ds.subQuestions.map((q) => ({ id: q.id, text: q.text })),
    rubric: ds.rubric,
    work: ds.work,
    posts: ds.posts.map((p) => ({ id: p.id, parentId: p.parentId, text: p.text })),
    hints,
  };
}
