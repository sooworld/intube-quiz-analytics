// 동시 오답 유사도. "같은 학생들이 함께 틀렸다"는 관찰이며, 두 문항이 같은 개념을 측정한다는 뜻이 아니다.
import type { ItemId, StudentId } from "../types";
import { wrongSet, type ResponseMatrix } from "./matrix";

/** 공동 오답자가 이 수보다 적으면 "근거 부족"으로 표시한다 */
export const MIN_CO_WRONG = 2;

export interface ItemPair {
  a: ItemId;
  b: ItemId;
  wrongA: number;
  wrongB: number;
  coWrong: number;
  union: number;
  /** 공동 오답자 / 합집합. 합집합이 0이면 null ("오답자 없음") */
  jaccard: number | null;
  sufficient: boolean;
}

function wrongStudentsByItem(m: ResponseMatrix): Map<ItemId, Set<StudentId>> {
  const map = new Map<ItemId, Set<StudentId>>();
  for (const it of m.items) map.set(it.id, new Set());
  for (const s of m.students) for (const id of wrongSet(m, s.id)) map.get(id)!.add(s.id);
  return map;
}

export function itemPair(m: ResponseMatrix, a: ItemId, b: ItemId): ItemPair {
  const w = wrongStudentsByItem(m);
  return pairFrom(a, b, w.get(a) ?? new Set(), w.get(b) ?? new Set());
}

function pairFrom(a: ItemId, b: ItemId, A: Set<StudentId>, B: Set<StudentId>): ItemPair {
  let co = 0;
  for (const s of A) if (B.has(s)) co++;
  const union = A.size + B.size - co;
  return {
    a,
    b,
    wrongA: A.size,
    wrongB: B.size,
    coWrong: co,
    union,
    jaccard: union === 0 ? null : co / union,
    sufficient: co >= MIN_CO_WRONG,
  };
}

/** 문항 × 문항 행렬 (대각선 포함) */
export function itemSimilarityMatrix(m: ResponseMatrix): ItemPair[][] {
  const w = wrongStudentsByItem(m);
  return m.items.map((ia) => m.items.map((ib) => pairFrom(ia.id, ib.id, w.get(ia.id)!, w.get(ib.id)!)));
}

/** 서로 다른 문항 쌍을 유사도 내림차순으로 (근거 부족 쌍은 뒤로) */
export function rankedItemPairs(m: ResponseMatrix): ItemPair[] {
  const mat = itemSimilarityMatrix(m);
  const pairs: ItemPair[] = [];
  for (let i = 0; i < mat.length; i++) for (let j = i + 1; j < mat.length; j++) pairs.push(mat[i]![j]!);
  return pairs.sort(
    (x, y) =>
      Number(y.sufficient) - Number(x.sufficient) ||
      (y.jaccard ?? -1) - (x.jaccard ?? -1) ||
      y.coWrong - x.coWrong ||
      (x.a + x.b < y.a + y.b ? -1 : 1),
  );
}

/** 두 집합의 Jaccard 거리. 둘 다 비어 있으면 0 (둘 다 전부 정답 = 같은 패턴). */
export function jaccardDistance<T>(A: Set<T>, B: Set<T>): number {
  let co = 0;
  for (const x of A) if (B.has(x)) co++;
  const union = A.size + B.size - co;
  return union === 0 ? 0 : 1 - co / union;
}

/** 학생 × 학생 오답 집합 Jaccard 거리 (m.students 순서) */
export function studentDistanceMatrix(m: ResponseMatrix): number[][] {
  const sets = m.students.map((s) => wrongSet(m, s.id));
  return sets.map((A) => sets.map((B) => jaccardDistance(A, B)));
}
