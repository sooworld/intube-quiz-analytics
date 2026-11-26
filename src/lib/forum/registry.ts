// 토론 데이터 레지스트리. 화면(data.ts)과 Mock(규칙 기반 단서가 데이터에 있음)이 함께 쓴다.
import { FORUM_F5 } from "./content/f5";
import { FORUM_LIT_F3 } from "./content/litF3";
import type { ForumDataset } from "./types";

const FORUMS: Record<string, ForumDataset> = {
  [FORUM_F5.forum.id]: FORUM_F5,
  [FORUM_LIT_F3.forum.id]: FORUM_LIT_F3,
};

export function forumIdList(): string[] {
  return Object.keys(FORUMS);
}

export function findForum(id: string): ForumDataset | null {
  return FORUMS[id] ?? null;
}

/** Mock 전용: 데이터에 든 규칙 단서를 꺼낸다. 없는 토론이면 오류 */
export function mockDatasetFor(id: string): ForumDataset {
  const ds = FORUMS[id];
  if (!ds) throw new Error(`알 수 없는 토론입니다: ${id}`);
  return ds;
}
