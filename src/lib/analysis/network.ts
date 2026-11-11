// 문항 유사도 네트워크. 연결 기준은 하나만 고른다 — "동시 오답"과 "개념 태그 공유"를 섞지 않는다.
import type { ItemId, QMatrix } from "../types";
import type { ResponseMatrix } from "./matrix";
import { itemSimilarityMatrix } from "./similarity";
import { sharedTags } from "./tagFit";

export type EdgeBasis = "cowrong" | "concept";

export interface NetworkEdge {
  a: ItemId;
  b: ItemId;
  /** cowrong: Jaccard, concept: 공유 태그 Jaccard (공유 태그 수 / 두 문항 태그 합집합 수) */
  weight: number;
  /** cowrong: 공동 오답자 수, concept: 공유 태그 수 */
  support: number;
  sharedConcepts: string[];
}

export function itemNetwork(m: ResponseMatrix, q: QMatrix, basis: EdgeBasis, threshold: number): NetworkEdge[] {
  const edges: NetworkEdge[] = [];
  const shared = (a: ItemId, b: ItemId) => sharedTags(a, b, q);
  if (basis === "cowrong") {
    const mat = itemSimilarityMatrix(m);
    for (let i = 0; i < mat.length; i++)
      for (let j = i + 1; j < mat.length; j++) {
        const p = mat[i]![j]!;
        if (p.sufficient && p.jaccard !== null && p.jaccard >= threshold - 1e-12)
          edges.push({ a: p.a, b: p.b, weight: p.jaccard, support: p.coWrong, sharedConcepts: shared(p.a, p.b) });
      }
  } else {
    const ids = m.items.map((i) => i.id);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const s = shared(a, b);
        const union = new Set([...(q[a] ?? []), ...(q[b] ?? [])]).size;
        const w = union ? s.length / union : 0;
        if (s.length > 0 && w >= threshold - 1e-12) edges.push({ a, b, weight: w, support: s.length, sharedConcepts: s });
      }
  }
  return edges.sort((x, y) => y.weight - x.weight || y.support - x.support);
}
