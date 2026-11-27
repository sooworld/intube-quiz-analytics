// 토론 AI 작업의 입력을 데이터에서 만든다 (순수 함수). 어휘 단서(TF-IDF)는 브라우저에서 계산한다(키 불필요).
import type { ForumDesignInput } from "../ai/tasks/forumDesign";
import type { ForumProfileInput } from "../ai/tasks/forumProfile";
import { fitForum, lexicalCandidates, parentOverlaps } from "./analysis";
import type { PostHint } from "./mockRules";
import { getSyllabus } from "../syllabus/registry";
import { detailSentences } from "../syllabus/resolve";
import type { ForumDataset } from "./types";

/** withDetail이면 목표마다 강의계획서 상세를 붙인다(forum-design-v2 입력). 기본은 v1 입력 그대로 */
export function designInput(ds: ForumDataset, opts: { withDetail?: boolean } = {}): ForumDesignInput {
  const details = opts.withDetail ? objectiveDetails(ds) : {};
  return {
    forumId: ds.forum.id,
    // 필요한 필드만 명시해 옮긴다. 객체를 통째로 넘기면 syllabusId 같은 필드가 붙을 때 basis 해시가 바뀐다
    objectives: ds.objectives.map((o) => (details[o.id] ? { id: o.id, kind: o.kind, text: o.text, detail: details[o.id] } : { id: o.id, kind: o.kind, text: o.text })),
    subQuestions: ds.subQuestions.map((q) => ({ id: q.id, text: q.text })),
    intro: ds.forum.intro,
  };
}

/** 토론 목표별 계획서 상세 (목표 id → 상세 원문). 계획서를 못 찾는 목표는 빠진다 */
export function objectiveDetails(ds: ForumDataset): Record<string, string> {
  const syl = getSyllabus(ds.forum.courseId);
  const out: Record<string, string> = {};
  if (!syl) return out;
  for (const o of ds.objectives) {
    const so = syl.objectives.find((x) => x.id === o.syllabusId);
    if (so) out[o.id] = so.detail;
  }
  return out;
}

/** 목표별 계획서 상세 문장 (설계 지도 연관도의 후보) */
export function objectiveDetailSentences(ds: ForumDataset): Record<string, string[]> {
  return Object.fromEntries(Object.entries(objectiveDetails(ds)).map(([id, d]) => [id, detailSentences(d)]));
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
