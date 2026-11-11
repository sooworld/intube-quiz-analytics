// Q-matrix 점검 (D7, decisions.md §4·§7): 공유 태그로 묶은 문항 쌍 phi의 기술값.
// 판정·유의성·문항별 적합성 수치는 만들지 않는다. 25명 규모에서 쌍 하나의 값은 크게 흔들리기 때문이다.
import type { Concept, ConceptId, Item, ItemId, QMatrix } from "../types";
import { pearson } from "./itemStats";
import type { ResponseMatrix } from "./matrix";

/** 두 문항이 함께 가진 개념 태그 (b의 태그 순서) */
export function sharedTags(a: ItemId, b: ItemId, q: QMatrix): ConceptId[] {
  const A = new Set(q[a] ?? []);
  return (q[b] ?? []).filter((c) => A.has(c));
}

/** 학생 × 문항 0/1 점수 (m.students 순, m.items 순). 오답·무응답 = 0 (§3) */
export function scoreRows(m: ResponseMatrix): number[][] {
  return m.students.map((s) => m.items.map((it) => (m.state[s.id]![it.id] === "correct" ? 1 : 0)));
}

/** 문항 × 문항 phi (대각선은 null). 한 문항의 분산이 0이면 그 쌍은 null("계산 불가") */
export type PhiMatrix = (number | null)[][];

export function phiFromRows(rows: number[][], k: number): PhiMatrix {
  const cols = Array.from({ length: k }, (_, j) => rows.map((r) => r[j]!));
  const phi: PhiMatrix = Array.from({ length: k }, () => Array<number | null>(k).fill(null));
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const r = pearson(cols[i]!, cols[j]!);
      const v = r === null || !Number.isFinite(r) ? null : r;
      phi[i]![j] = v;
      phi[j]![i] = v;
    }
  return phi;
}

export function phiMatrix(m: ResponseMatrix): PhiMatrix {
  return phiFromRows(scoreRows(m), m.items.length);
}

/** 두 문항의 2×2 관찰 빈도 (조정 전). 오답에는 무응답이 포함된다. */
export interface PairTable {
  a: ItemId;
  b: ItemId;
  bothCorrect: number;
  aOnly: number;
  bOnly: number;
  bothWrong: number;
  /** 두 문항 모두 무응답인 인원 (bothWrong에 포함) */
  bothUnanswered: number;
  n: number;
}

export function pairTable(m: ResponseMatrix, a: ItemId, b: ItemId): PairTable {
  const t: PairTable = { a, b, bothCorrect: 0, aOnly: 0, bOnly: 0, bothWrong: 0, bothUnanswered: 0, n: m.students.length };
  for (const s of m.students) {
    const sa = m.state[s.id]![a];
    const sb = m.state[s.id]![b];
    const ca = sa === "correct";
    const cb = sb === "correct";
    if (ca && cb) t.bothCorrect++;
    else if (ca) t.aOnly++;
    else if (cb) t.bOnly++;
    else t.bothWrong++;
    if (sa === "unanswered" && sb === "unanswered") t.bothUnanswered++;
  }
  return t;
}

export type PairKind = "shared" | "other" | "untagged";

/** 쌍 종류: 공유 태그 있음 / 공유 태그 없음(둘 다 태그 있음) / 태그 없는 문항 포함 */
export function pairKind(a: ItemId, b: ItemId, q: QMatrix): PairKind {
  if ((q[a] ?? []).length === 0 || (q[b] ?? []).length === 0) return "untagged";
  return sharedTags(a, b, q).length > 0 ? "shared" : "other";
}

/** 묶음 평균. total = 묶음에 속한 쌍 수, valid = 그중 phi를 계산할 수 있는 쌍 수 */
export interface GroupMean {
  mean: number | null;
  valid: number;
  total: number;
}

function groupMean(values: (number | null)[]): GroupMean {
  const ok = values.filter((v): v is number => v !== null);
  return { mean: ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null, valid: ok.length, total: values.length };
}

export interface TagContrast {
  shared: GroupMean;
  other: GroupMean;
  /** 태그 없는 문항이 낀 쌍 수 (어느 묶음에도 넣지 않는다) */
  untaggedPairs: number;
  /** 공유 있음 평균 − 공유 없음 평균. 한쪽이라도 계산 가능한 쌍이 없으면 null */
  diff: number | null;
}

function contrastFrom(phi: PhiMatrix, items: Item[], q: QMatrix, keep?: (i: number, j: number) => boolean): TagContrast {
  const shared: (number | null)[] = [];
  const other: (number | null)[] = [];
  let untaggedPairs = 0;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const kind = pairKind(items[i]!.id, items[j]!.id, q);
      if (kind === "untagged") {
        untaggedPairs++;
        continue;
      }
      if (keep && !keep(i, j)) continue;
      (kind === "shared" ? shared : other).push(phi[i]![j]!);
    }
  const s = groupMean(shared);
  const o = groupMean(other);
  return { shared: s, other: o, untaggedPairs, diff: s.mean !== null && o.mean !== null ? s.mean - o.mean : null };
}

/** items는 phi 행렬과 같은 순서(m.items)여야 한다 */
export function tagContrast(phi: PhiMatrix, items: Item[], q: QMatrix): TagContrast {
  return contrastFrom(phi, items, q);
}

export interface ConceptContrast {
  conceptId: ConceptId;
  itemCount: number;
  /** 이 개념이 태그된 문항끼리의 쌍 */
  within: GroupMean;
  /** 이 개념 문항 × (태그가 있으면서 그 문항과 공유 태그가 없는 문항) 쌍 */
  outside: GroupMean;
}

export function conceptContrast(phi: PhiMatrix, items: Item[], q: QMatrix, concepts: Concept[]): ConceptContrast[] {
  return concepts.map((c) => {
    const within: (number | null)[] = [];
    const outside: (number | null)[] = [];
    const has = (i: number) => (q[items[i]!.id] ?? []).includes(c.id);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const hi = has(i);
        const hj = has(j);
        if (hi && hj) within.push(phi[i]![j]!);
        else if ((hi || hj) && pairKind(items[i]!.id, items[j]!.id, q) === "other") outside.push(phi[i]![j]!);
      }
    return { conceptId: c.id, itemCount: items.filter((_, i) => has(i)).length, within: groupMean(within), outside: groupMean(outside) };
  });
}

export interface LooRange {
  min: number | null;
  max: number | null;
  /** 유효 반복 수 */
  valid: number;
  /** 전체 반복 수 (= 응시 완료 인원) */
  total: number;
}

/**
 * 학생 1명씩 빼고 다시 계산한 차이(diff)의 범위.
 * 전체 자료에서 계산 가능한 쌍 집합을 고정하고, 한 명을 뺐을 때 그중 하나라도 계산 불가가 되면 그 반복은 무효로 친다.
 * 한 학생에 대한 민감도일 뿐, 다른 학급에서의 재현을 뜻하지 않는다.
 */
export function looContrast(m: ResponseMatrix, q: QMatrix): LooRange {
  const rows = scoreRows(m);
  const k = m.items.length;
  const full = phiFromRows(rows, k);
  const base = contrastFrom(full, m.items, q);
  const total = rows.length;
  if (base.diff === null) return { min: null, max: null, valid: 0, total };
  const fixed = (i: number, j: number) => full[i]![j] !== null;
  let min = Infinity;
  let max = -Infinity;
  let valid = 0;
  for (let s = 0; s < rows.length; s++) {
    const phi = phiFromRows(rows.filter((_, t) => t !== s), k);
    let broken = false;
    for (let i = 0; i < k && !broken; i++)
      for (let j = i + 1; j < k; j++)
        if (fixed(i, j) && pairKind(m.items[i]!.id, m.items[j]!.id, q) !== "untagged" && phi[i]![j] === null) {
          broken = true;
          break;
        }
    if (broken) continue;
    const d = contrastFrom(phi, m.items, q, fixed).diff;
    if (d === null) continue;
    valid++;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return valid ? { min, max, valid, total } : { min: null, max: null, valid: 0, total };
}
