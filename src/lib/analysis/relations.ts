// 개념 관계 (docs/decisions.md §8.5). 관계는 교수가 내용으로 정한 가정이고, 응답 데이터는 중복 현황으로만 보여 준다.
import type { Concept, ConceptId, ItemId, QMatrix } from "../types";
import { conceptGroups, DEFAULT_THRESHOLD } from "./groups";
import { itemsForConcept, type ResponseMatrix } from "./matrix";

export type RelationType = "prerequisite" | "related" | "confusable";

export const RELATION_LABEL: Record<RelationType, string> = {
  prerequisite: "선수",
  related: "관련",
  confusable: "혼동",
};

export interface RelationLike {
  from: ConceptId;
  to: ConceptId;
  type: RelationType;
}

/** 같은 쌍 판정용 키. 선수는 방향이 있고, 관련·혼동은 방향이 없다 */
export function pairKey(r: RelationLike): string {
  if (r.type === "prerequisite") return `${r.from}>${r.to}`;
  const [a, b] = [r.from, r.to].sort();
  return `${a}~${b}`;
}

/** 두 개념 사이의 관계 존재 여부(유형 무관, 방향 무관) */
export function unorderedKey(a: ConceptId, b: ConceptId): string {
  return [a, b].sort().join("|");
}

/**
 * 선수 관계 그래프에서 순환을 찾는다. 있으면 순환 경로(개념 id, 처음과 끝이 같음), 없으면 null.
 * 병합·수동 추가·유형 변경·저장·복원 때마다 같은 함수를 쓴다.
 */
export function detectCycle(relations: RelationLike[]): ConceptId[] | null {
  const adj = new Map<ConceptId, ConceptId[]>();
  for (const r of relations) if (r.type === "prerequisite") adj.set(r.from, [...(adj.get(r.from) ?? []), r.to]);
  const state = new Map<ConceptId, 1 | 2>(); // 1 = 방문 중, 2 = 끝남
  const stack: ConceptId[] = [];
  const visit = (v: ConceptId): ConceptId[] | null => {
    state.set(v, 1);
    stack.push(v);
    for (const w of adj.get(v) ?? []) {
      if (state.get(w) === 1) return [...stack.slice(stack.indexOf(w)), w];
      if (!state.has(w)) {
        const c = visit(w);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(v, 2);
    return null;
  };
  for (const v of [...adj.keys()].sort()) {
    if (!state.has(v)) {
      const c = visit(v);
      if (c) return c;
    }
  }
  return null;
}

export interface OverlapTable {
  a: ConceptId;
  b: ConceptId;
  threshold: number;
  /** 응시 완료 인원 */
  n: number;
  both: number;
  aOnly: number;
  bOnly: number;
  neither: number;
  /** 두 개념에 함께 태그된 문항 */
  sharedItemIds: ItemId[];
}

/**
 * 중복 현황: 두 개념 보충 그룹(같은 기준) 소속의 2×2 빈도. 관계가 맞는지 판단하는 근거가 아니다.
 * 공유 문항을 빼고 다시 계산하지 않는다(문항 수가 바뀌어 기준 판정 자체가 달라진다).
 */
export function overlapTable(m: ResponseMatrix, q: QMatrix, concepts: Concept[], a: ConceptId, b: ConceptId, threshold = DEFAULT_THRESHOLD): OverlapTable {
  const groups = conceptGroups(m, q, concepts, threshold);
  const members = (id: ConceptId) => new Set(groups.find((g) => g.conceptId === id)?.members.map((x) => x.studentId) ?? []);
  const A = members(a);
  const B = members(b);
  let both = 0;
  let aOnly = 0;
  let bOnly = 0;
  let neither = 0;
  for (const s of m.students) {
    const inA = A.has(s.id);
    const inB = B.has(s.id);
    if (inA && inB) both++;
    else if (inA) aOnly++;
    else if (inB) bOnly++;
    else neither++;
  }
  const bItems = new Set(itemsForConcept(m, q, b));
  const sharedItemIds = itemsForConcept(m, q, a).filter((id) => bItems.has(id));
  return { a, b, threshold, n: m.students.length, both, aOnly, bOnly, neither, sharedItemIds };
}
