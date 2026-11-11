// 문항분석: 정답률(Facility), 선택지 분포, 단답 오답 묶음, 변별도(참고값).
import type { Item, ItemId, Measure } from "../types";
import { misconceptionCandidate, normalizeAnswer } from "./grading";
import { measure, type ResponseMatrix } from "./matrix";

export interface OptionCount {
  optionId: string;
  text: string;
  count: number;
  isCorrect: boolean;
  misconception: string | null;
}

export interface ShortAnswerGroup {
  /** 정규화된 답안 */
  key: string;
  count: number;
  correct: boolean;
  /** 오개념 후보 라벨 (규칙에 맞지 않으면 null = 미분류) */
  misconception: string | null;
  /** 원답안 예시 (중복 제거) */
  examples: string[];
}

export interface ItemStat {
  itemId: ItemId;
  /** 정답 인원 / 응시 완료 인원 */
  facility: Measure;
  unanswered: number;
  /** 문항 점수와 나머지 문항 총점의 피어슨 상관 (Moodle 방식). 분산 0이면 null. */
  discrimination: number | null;
  options?: OptionCount[];
  shortGroups?: ShortAnswerGroup[];
}

export function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 2 || y.length !== n) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function itemStat(m: ResponseMatrix, item: Item): ItemStat {
  const n = m.students.length;
  let correct = 0;
  let unanswered = 0;
  const itemScores: number[] = [];
  const restScores: number[] = [];
  for (const s of m.students) {
    const st = m.state[s.id]![item.id];
    if (st === "correct") correct++;
    if (st === "unanswered") unanswered++;
    itemScores.push(st === "correct" ? 1 : 0);
    let rest = 0;
    for (const other of m.items) {
      if (other.id !== item.id && m.state[s.id]![other.id] === "correct") rest++;
    }
    restScores.push(rest);
  }

  const stat: ItemStat = {
    itemId: item.id,
    facility: measure(correct, n, [item.id]),
    unanswered,
    discrimination: pearson(itemScores, restScores),
  };

  if (item.type === "mcq") {
    stat.options = (item.options ?? []).map((o) => ({
      optionId: o.id,
      text: o.text,
      count: m.students.filter((s) => m.raw[s.id]![item.id] === o.id).length,
      isCorrect: o.id === item.correctOptionId,
      misconception: o.misconception ?? null,
    }));
  } else {
    const groups = new Map<string, ShortAnswerGroup>();
    for (const s of m.students) {
      const raw = m.raw[s.id]![item.id] ?? null;
      if (raw === null) continue;
      const key = normalizeAnswer(raw);
      const g = groups.get(key) ?? {
        key,
        count: 0,
        correct: m.state[s.id]![item.id] === "correct",
        misconception: m.state[s.id]![item.id] === "correct" ? null : misconceptionCandidate(item, raw),
        examples: [],
      };
      g.count++;
      if (!g.examples.includes(raw)) g.examples.push(raw);
      groups.set(key, g);
    }
    stat.shortGroups = [...groups.values()].sort(
      (a, b) => Number(b.correct) - Number(a.correct) || b.count - a.count || (a.key < b.key ? -1 : 1),
    );
  }
  return stat;
}

export function allItemStats(m: ResponseMatrix): ItemStat[] {
  return m.items.map((it) => itemStat(m, it));
}

/** 학생 총점 (정답 수) */
export function totalScore(m: ResponseMatrix, sid: string): number {
  return m.items.filter((i) => m.state[sid]?.[i.id] === "correct").length;
}
