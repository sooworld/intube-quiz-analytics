// 채점 (D3). 채점 결과(정오)와 오답 묶음(오개념 후보)은 분리한다.
import type { GradedState, Item, MisconceptionRule } from "../types";

/**
 * 기본 정규화: 유니코드 NFKC, 앞뒤 공백 제거, 연속 공백 하나로, 소문자.
 * 문장부호와 내부 공백은 지우지 않는다 (예: "-1"과 "1", "0.05"와 "005"를 합치지 않기 위해).
 */
export function normalizeAnswer(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** 숫자 해석. 정규화 후 전체가 하나의 수여야 한다 ("5.0" 허용, "5cm"·"약 5" 불허). */
export function parseNumeric(normalized: string): number | null {
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function gradeItem(item: Item, rawAnswer: string | null): GradedState {
  if (rawAnswer === null || rawAnswer.trim() === "") return "unanswered";
  if (item.type === "mcq") {
    return rawAnswer === item.correctOptionId ? "correct" : "incorrect";
  }
  const spec = item.shortAnswer;
  if (!spec) throw new Error(`단답 문항 ${item.id}에 채점 정책이 없습니다`);
  const normalized = normalizeAnswer(rawAnswer);
  if (spec.policy === "numeric") {
    const value = parseNumeric(normalized);
    if (value === null) return "incorrect";
    const tolerance = spec.tolerance ?? 0;
    return spec.accepted.some((a) => {
      const target = Number(a);
      return Math.abs(value - target) <= tolerance + 1e-12;
    })
      ? "correct"
      : "incorrect";
  }
  return spec.accepted.some((a) => normalizeAnswer(a) === normalized) ? "correct" : "incorrect";
}

function matchesRule(normalized: string, rule: MisconceptionRule): boolean {
  if (rule.equals?.some((e) => normalizeAnswer(e) === normalized)) return true;
  if (rule.includesAll && rule.includesAll.length > 0) {
    return rule.includesAll.every((part) => normalized.includes(normalizeAnswer(part)));
  }
  return false;
}

/**
 * 오답의 오개념 후보 라벨. 규칙에 맞지 않으면 null(미분류).
 * 이 라벨은 "규칙에 따른 후보"이며 학생의 실제 사고를 확정하지 않는다.
 */
export function misconceptionCandidate(item: Item, rawAnswer: string | null): string | null {
  if (rawAnswer === null) return null;
  if (item.type === "mcq") {
    return item.options?.find((o) => o.id === rawAnswer)?.misconception ?? null;
  }
  const normalized = normalizeAnswer(rawAnswer);
  const rule = item.shortAnswer?.misconceptionRules?.find((r) => matchesRule(normalized, r));
  return rule?.label ?? null;
}
