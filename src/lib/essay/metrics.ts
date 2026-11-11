// 서술형 지표 (docs/decisions.md §6.4). 분자·분모를 함께 돌려준다.
import type { CriterionLevels, EssayQuizDataset, RubricLevel } from "../types";
import type { StoredSuggestion } from "../ai/types";
import { recordKey, type EssayGradesState, type FinalSource } from "./grades";

export interface Ratio {
  numerator: number;
  denominator: number;
  /** 분모가 0이면 null("자료 없음") */
  value: number | null;
}

const ratio = (n: number, d: number): Ratio => ({ numerator: n, denominator: d, value: d === 0 ? null : n / d });

/** 채점 대상 = 응시 완료 학생의 제출(무응답 포함) */
export function gradableKeys(ds: EssayQuizDataset): string[] {
  return ds.submissions.map((s) => recordKey(s.attemptId, s.itemId));
}

export function confirmation(ds: EssayQuizDataset, st: EssayGradesState): Ratio {
  const keys = gradableKeys(ds);
  return ratio(keys.filter((k) => st.records[k]?.final).length, keys.length);
}

export interface Agreement {
  pairs: number;
  exact: Ratio;
  within1: Ratio;
  /** 평균 절대 차이. 쌍이 없으면 null */
  mae: number | null;
  over: number;
  under: number;
}

function agreement(pairs: [RubricLevel, RubricLevel][]): Agreement {
  // [제안, 비교 대상]
  const exact = pairs.filter(([a, b]) => a === b).length;
  const within1 = pairs.filter(([a, b]) => Math.abs(a - b) <= 1).length;
  const abs = pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0);
  return {
    pairs: pairs.length,
    exact: ratio(exact, pairs.length),
    within1: ratio(within1, pairs.length),
    mae: pairs.length ? abs / pairs.length : null,
    over: pairs.filter(([a, b]) => a > b).length,
    under: pairs.filter(([a, b]) => a < b).length,
  };
}

function criterionPairs(ds: EssayQuizDataset, itemId: string, suggestion: CriterionLevels, other: CriterionLevels, criterionId?: string): [RubricLevel, RubricLevel][] {
  const item = ds.quiz.items.find((i) => i.id === itemId)!;
  return item.rubric
    .filter((c) => !criterionId || c.id === criterionId)
    .filter((c) => suggestion[c.id] !== undefined && other[c.id] !== undefined)
    .map((c) => [suggestion[c.id]!, other[c.id]!]);
}

export interface AiVsFinal {
  /** 확정 출처별 건수 (모든 확정) */
  bySource: Record<FinalSource, number>;
  /** 유효 제안에 연결된 확정의 기준 쌍 */
  overall: Agreement;
  byCriterion: Record<string, Agreement>;
  /** 비교한 확정 건수 */
  linkedFinals: number;
}

/** AI 제안 vs 교수 확정: 유효(valid·needs-review) 제안에 연결된 확정만 비교한다 */
export function aiVsFinal(ds: EssayQuizDataset, st: EssayGradesState): AiVsFinal {
  const bySource: Record<FinalSource, number> = { accepted: 0, edited: 0, manual: 0 };
  const all: [RubricLevel, RubricLevel][] = [];
  const perCrit: Record<string, [RubricLevel, RubricLevel][]> = {};
  let linked = 0;
  for (const s of ds.submissions) {
    const rec = st.records[recordKey(s.attemptId, s.itemId)];
    if (!rec?.final) continue;
    bySource[rec.final.source]++;
    const sug = rec.suggestions.find((x) => x.suggestionId === rec.final!.basedOnSuggestionId);
    if (!sug || sug.result.status === "invalid") continue;
    linked++;
    const sl = Object.fromEntries(sug.result.criteria.map((c) => [c.criterionId, c.level])) as CriterionLevels;
    for (const c of ds.quiz.items.find((i) => i.id === s.itemId)!.rubric) {
      const p = criterionPairs(ds, s.itemId, sl, rec.final.levels, c.id);
      all.push(...p);
      (perCrit[c.id] ??= []).push(...p);
    }
  }
  return {
    bySource,
    overall: agreement(all),
    byCriterion: Object.fromEntries(Object.entries(perCrit).map(([k, v]) => [k, agreement(v)])),
    linkedFinals: linked,
  };
}

export interface ReferenceAgreement {
  provider: string;
  model: string;
  generated: Agreement;
  holdout: Agreement;
  submissions: { generated: number; holdout: number };
}

/**
 * 데모 전용: 제공자·모델별 최신 유효 제안 vs 기준 채점. 생성 답안과 보류 답안을 나눈다.
 * 제공자를 섞으면 어느 모델의 성능인지 알 수 없으므로 묶음별로 따로 센다.
 */
export function aiVsReference(ds: EssayQuizDataset, st: EssayGradesState): ReferenceAgreement[] {
  const groups = new Map<string, { provider: string; model: string; pairs: Record<"generated" | "holdout", [RubricLevel, RubricLevel][]>; subs: Record<"generated" | "holdout", number> }>();
  for (const ref of ds.referenceGrades) {
    const rec = st.records[recordKey(ref.attemptId, ref.itemId)];
    const latestByGroup = new Map<string, StoredSuggestion>();
    for (const s of rec?.suggestions ?? []) if (s.result.status !== "invalid") latestByGroup.set(`${s.provider}|${s.model}`, s);
    for (const [g, s] of latestByGroup) {
      const entry = groups.get(g) ?? { provider: s.provider, model: s.model, pairs: { generated: [], holdout: [] }, subs: { generated: 0, holdout: 0 } };
      entry.subs[ref.origin]++;
      const sl = Object.fromEntries(s.result.criteria.map((c) => [c.criterionId, c.level])) as CriterionLevels;
      entry.pairs[ref.origin].push(...criterionPairs(ds, ref.itemId, sl, ref.levels));
      groups.set(g, entry);
    }
  }
  return [...groups.values()]
    .sort((x, y) => `${x.provider}|${x.model}`.localeCompare(`${y.provider}|${y.model}`))
    .map((e) => ({ provider: e.provider, model: e.model, generated: agreement(e.pairs.generated), holdout: agreement(e.pairs.holdout), submissions: e.subs }));
}

/** 개념 점수율 = 확정 기준 점수 합 / 해당 개념 기준 최대점수 합 */
export function conceptScoreRates(ds: EssayQuizDataset, st: EssayGradesState): { conceptId: string; rate: Ratio; criteria: number }[] {
  return ds.quiz.concepts.map((concept) => {
    let n = 0;
    let d = 0;
    let criteria = 0;
    for (const item of ds.quiz.items) {
      const tagged = item.rubric.filter((c) => c.conceptIds.includes(concept.id));
      criteria += tagged.length;
      if (tagged.length === 0) continue;
      for (const s of ds.submissions.filter((x) => x.itemId === item.id)) {
        const f = st.records[recordKey(s.attemptId, s.itemId)]?.final;
        if (!f) continue;
        for (const c of tagged) {
          n += f.levels[c.id] ?? 0;
          d += 2;
        }
      }
    }
    return { conceptId: concept.id, rate: ratio(n, d), criteria };
  });
}

/** 기준별 확정 수준 분포 */
export function levelDistribution(ds: EssayQuizDataset, st: EssayGradesState): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const item of ds.quiz.items) for (const c of item.rubric) out[c.id] = [0, 0, 0];
  for (const s of ds.submissions) {
    const f = st.records[recordKey(s.attemptId, s.itemId)]?.final;
    if (!f) continue;
    for (const [cid, lv] of Object.entries(f.levels)) if (out[cid]) out[cid]![lv]++;
  }
  return out;
}
