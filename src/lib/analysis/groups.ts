// 그룹 제안 (D2). 기본은 개념별 보충 그룹(규칙 기반, 중복 소속 허용), 탐색은 학생 계층 군집·밀도 기반 무리.
// 탐색 보기는 그림(덴드로그램·2차원 배치·k-거리) 없이 묶음 결과만 낸다(decisions U14).
import type { Concept, ConceptId, ItemId, Measure, QMatrix, StudentId } from "../types";
import { studentConcept } from "./concepts";
import { cutTree, hclustAverage } from "./hclust";
import { isWrong, withoutItem, type ResponseMatrix } from "./matrix";
import { dbscan } from "./dbscan";
import { studentDistanceMatrix } from "./similarity";

export const DEFAULT_THRESHOLD = 0.5;

/** 탐색 보기의 화면 이름 (교수용 쉬운 말, decisions U14). 계층 군집 = 묶기, 밀도 기반 = 무리 찾기 */
export const EXPLORE_LABEL = { cluster: "오답이 비슷한 학생끼리 묶기", density: "비슷한 학생이 몰린 무리 찾기" } as const;

export interface ConceptGroup {
  conceptId: ConceptId;
  /** 기준 이상 오답한 학생과 그 근거 */
  members: { studentId: StudentId; measure: Measure }[];
  /** 개념 태그 문항이 없으면 false ("자료 없음") */
  hasEvidence: boolean;
}

export function conceptGroups(
  m: ResponseMatrix,
  q: QMatrix,
  concepts: Concept[],
  threshold = DEFAULT_THRESHOLD,
): ConceptGroup[] {
  return concepts.map((c) => {
    const rows = m.students.map((s) => ({ studentId: s.id, measure: studentConcept(m, q, s.id, c.id) }));
    const hasEvidence = rows.some((r) => r.measure.denominator > 0);
    return {
      conceptId: c.id,
      hasEvidence,
      members: rows.filter((r) => r.measure.value !== null && r.measure.numerator > 0 && r.measure.value >= threshold - 1e-12),
    };
  });
}

export interface ClusterSummary {
  label: number;
  studentIds: StudentId[];
  /** 구성원 절반 이상이 틀린 문항 (공통 근거) */
  commonWrongItems: { itemId: ItemId; wrong: number }[];
  /** 개념별 구성원 평균 관찰 오답률 */
  conceptMeans: Record<ConceptId, number | null>;
}

export interface Exploration {
  /** m.students 순서의 학생 id */
  studentIds: StudentId[];
  labels: number[];
  clusters: ClusterSummary[];
}

export function exploreClusters(m: ResponseMatrix, q: QMatrix, concepts: Concept[], k: number): Exploration {
  const labels = cutTree(hclustAverage(studentDistanceMatrix(m)), k);
  const studentIds = m.students.map((s) => s.id);
  return { studentIds, labels, clusters: summarizeClusters(m, q, concepts, studentIds, labels) };
}

export function summarizeClusters(
  m: ResponseMatrix,
  q: QMatrix,
  concepts: Concept[],
  studentIds: StudentId[],
  labels: number[],
): ClusterSummary[] {
  const byLabel = new Map<number, StudentId[]>();
  studentIds.forEach((sid, i) => {
    const l = labels[i]!;
    if (l < 0) return;
    byLabel.set(l, [...(byLabel.get(l) ?? []), sid]);
  });
  return [...byLabel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([label, ids]) => {
      const commonWrongItems = m.items
        .map((it) => ({ itemId: it.id, wrong: ids.filter((sid) => isWrong(m, sid, it.id)).length }))
        .filter((x) => x.wrong > 0 && x.wrong * 2 >= ids.length)
        .sort((a, b) => b.wrong - a.wrong);
      const conceptMeans = Object.fromEntries(
        concepts.map((c) => {
          const vals = ids.map((sid) => studentConcept(m, q, sid, c.id).value).filter((v): v is number => v !== null);
          return [c.id, vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null];
        }),
      );
      return { label, studentIds: ids, commonWrongItems, conceptMeans };
    });
}

// ── 민감도: 문항 하나를 뺐을 때 소속이 바뀌는 학생 수 (decisions §4, U15) ──

/**
 * 상호배타 분할 두 개 사이에서 다른 묶음으로 옮겨 간 학생 수.
 * 묶음 번호는 임의라서, 두 분할의 묶음을 일대일로 맞춰 같은 묶음에 남는 학생이 가장 많아지게 한 뒤(최대 일치) 나머지를 센다.
 * -1(현재 조건에서 그룹 미배정)은 묶음이 아니다: 두 번 다 미배정이면 그대로이고, 한쪽만 미배정이면 옮겨 간 것으로 센다.
 */
export function movedCount(labelsA: number[], labelsB: number[]): number {
  const a = [...new Set(labelsA.filter((l) => l >= 0))];
  const b = [...new Set(labelsB.filter((l) => l >= 0))];
  const overlap = a.map((x) => b.map((y) => labelsA.filter((l, i) => l === x && labelsB[i] === y).length));
  // 최대 일치: B 묶음을 쓴 집합(비트)마다 가장 큰 일치 수를 들고 A 묶음을 하나씩 맞춘다. 묶음 수는 학생 수/최소 인원 이하라 작다
  let best = new Map<number, number>([[0, 0]]);
  for (const row of overlap) {
    const next = new Map(best);
    for (const [used, v] of best) {
      row.forEach((n, j) => {
        if (used & (1 << j)) return;
        const key = used | (1 << j);
        if ((next.get(key) ?? -1) < v + n) next.set(key, v + n);
      });
    }
    best = next;
  }
  const stayed = Math.max(...best.values()) + labelsA.filter((l, i) => l < 0 && labelsB[i]! < 0).length;
  return labelsA.length - stayed;
}

export interface Sensitivity {
  /** 문항별로 그 문항을 뺐을 때 소속이 바뀐 학생 수 */
  perItem: { itemId: ItemId; changed: number }[];
  max: number;
}

export function clusterSensitivity(m: ResponseMatrix, k: number): Sensitivity {
  const base = cutTree(hclustAverage(studentDistanceMatrix(m)), k);
  const perItem = m.items.map((it) => {
    const labels = cutTree(hclustAverage(studentDistanceMatrix(withoutItem(m, it.id))), k);
    return { itemId: it.id, changed: movedCount(base, labels) };
  });
  return { perItem, max: Math.max(0, ...perItem.map((p) => p.changed)) };
}

/** 개념 그룹 민감도: 문항 하나를 빼면 개념 그룹 소속(학생-개념 쌍)이 바뀌는 학생 수 */
export function conceptGroupSensitivity(m: ResponseMatrix, q: QMatrix, concepts: Concept[], threshold = DEFAULT_THRESHOLD): Sensitivity {
  const key = (gs: ConceptGroup[]) => {
    const map = new Map<StudentId, string>();
    for (const s of m.students) map.set(s.id, gs.filter((g) => g.members.some((x) => x.studentId === s.id)).map((g) => g.conceptId).join(","));
    return map;
  };
  const base = key(conceptGroups(m, q, concepts, threshold));
  const perItem = m.items.map((it) => {
    const after = key(conceptGroups(withoutItem(m, it.id), q, concepts, threshold));
    let changed = 0;
    for (const s of m.students) if (base.get(s.id) !== after.get(s.id)) changed++;
    return { itemId: it.id, changed };
  });
  return { perItem, max: Math.max(0, ...perItem.map((p) => p.changed)) };
}

// ── 밀도 기반 탐색 (DBSCAN) ──

export interface DensityExploration {
  studentIds: StudentId[];
  /** -1 = 현재 조건에서 그룹 미배정 */
  labels: number[];
  clusters: ClusterSummary[];
  unassigned: StudentId[];
}

export function exploreDensity(m: ResponseMatrix, q: QMatrix, concepts: Concept[], eps: number, minPts: number): DensityExploration {
  const r = dbscan(studentDistanceMatrix(m), eps, minPts);
  const studentIds = m.students.map((s) => s.id);
  return {
    studentIds,
    labels: r.labels,
    clusters: summarizeClusters(m, q, concepts, studentIds, r.labels),
    unassigned: studentIds.filter((_, i) => r.labels[i] === -1),
  };
}

export function densitySensitivity(m: ResponseMatrix, eps: number, minPts: number): Sensitivity {
  const base = dbscan(studentDistanceMatrix(m), eps, minPts).labels;
  const perItem = m.items.map((it) => {
    const labels = dbscan(studentDistanceMatrix(withoutItem(m, it.id)), eps, minPts).labels;
    return { itemId: it.id, changed: movedCount(base, labels) };
  });
  return { perItem, max: Math.max(0, ...perItem.map((p) => p.changed)) };
}

// ── 개념 묶음 보충 그룹 (docs/decisions.md §8.5) ──
// 교수가 확정 관계로 고른 개념 묶음. 구성원은 각 개념 보충 그룹(같은 기준)의 합집합이다.
// 새 오답률을 만들지 않고, 학생마다 어느 개념 기준에 들었는지를 함께 돌려준다.

export interface BundleMember {
  studentId: StudentId;
  /** 묶음의 각 개념에 대한 관찰 오답률과 기준 충족 여부 */
  perConcept: { conceptId: ConceptId; measure: Measure; meets: boolean }[];
}

export interface BundleGroup {
  conceptIds: ConceptId[];
  threshold: number;
  members: BundleMember[];
}

export function bundleGroup(m: ResponseMatrix, q: QMatrix, concepts: Concept[], conceptIds: ConceptId[], threshold = DEFAULT_THRESHOLD): BundleGroup {
  const ids = concepts.map((c) => c.id).filter((id) => conceptIds.includes(id));
  const groups = conceptGroups(m, q, concepts, threshold).filter((g) => ids.includes(g.conceptId));
  const meets = new Map(groups.map((g) => [g.conceptId, new Set(g.members.map((x) => x.studentId))]));
  const members: BundleMember[] = [];
  for (const s of m.students) {
    const perConcept = ids.map((cid) => ({ conceptId: cid, measure: studentConcept(m, q, s.id, cid), meets: meets.get(cid)?.has(s.id) ?? false }));
    if (perConcept.some((p) => p.meets)) members.push({ studentId: s.id, perConcept });
  }
  return { conceptIds: ids, threshold, members };
}

/** 묶음 그룹 민감도: 문항 하나를 빼면 묶음 소속(학생-묶음 쌍)이 바뀌는 학생 수 */
export function bundleSensitivity(m: ResponseMatrix, q: QMatrix, concepts: Concept[], bundles: ConceptId[][], threshold = DEFAULT_THRESHOLD): Sensitivity {
  const key = (mm: ResponseMatrix) => {
    const sets = bundles.map((ids) => new Set(bundleGroup(mm, q, concepts, ids, threshold).members.map((x) => x.studentId)));
    return new Map(m.students.map((s) => [s.id, sets.map((set) => (set.has(s.id) ? 1 : 0)).join()]));
  };
  const base = key(m);
  const perItem = m.items.map((it) => {
    const after = key(withoutItem(m, it.id));
    let changed = 0;
    for (const s of m.students) if (base.get(s.id) !== after.get(s.id)) changed++;
    return { itemId: it.id, changed };
  });
  return { perItem, max: Math.max(0, ...perItem.map((p) => p.changed)) };
}

/**
 * 선택한 관계로 이어진 개념들을 묶음으로 나눈다(연결 요소). 관계가 공유하는 개념이 있으면 한 묶음이 된다.
 * 결과는 개념 순서를 따른다.
 */
export function bundlesFromRelations(concepts: Concept[], relations: { from: ConceptId; to: ConceptId }[]): ConceptId[][] {
  const parent = new Map<ConceptId, ConceptId>();
  const find = (x: ConceptId): ConceptId => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const r of relations) {
    parent.set(r.from, find(r.from));
    parent.set(r.to, find(r.to));
    parent.set(find(r.from), find(r.to));
  }
  const groups = new Map<ConceptId, ConceptId[]>();
  for (const c of concepts) if (parent.has(c.id)) groups.set(find(c.id), [...(groups.get(find(c.id)) ?? []), c.id]);
  return [...groups.values()];
}
