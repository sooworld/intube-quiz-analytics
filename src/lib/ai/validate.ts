// 제안 검증 (계획 T3, docs/decisions.md §6.3). 모델 출력은 믿지 않는다.
// - invalid: 구조가 틀렸다 → 수락 불가, 직접 채점만
// - needs-review: 구조는 맞지만 근거가 답안에 없거나 지시문 주입이 의심된다 → 수정 후 확정만
// - valid: 수락 가능
// 총점은 모델이 보낸 값을 쓰지 않고 여기서 계산한다.
import type { EssayItem, RubricLevel } from "../types";
import { instructionSpans } from "./injection";
import { LIMITS } from "./prompt";
import {
  MODEL_FLAGS,
  type CriterionIssue,
  type ModelFlag,
  type SuggestionFlag,
  type ValidatedCriterion,
  type ValidatedSuggestion,
} from "./types";

export const VALIDATOR_VERSION = "2";

/** 글자 수: 분해형(NFD) 한글이 두 배로 세지지 않게 NFC로 맞춘 뒤 코드 포인트를 센다 */
export function charCount(text: string): number {
  return [...text.normalize("NFC")].length;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** 모델이 인용 앞뒤에 붙이기 쉬운 따옴표·말줄임표를 걷어 낸다 */
function trimQuote(q: string): string {
  return q.trim().replace(/^["'“”‘’「」『』…\s]+|["'“”‘’「」『』…\s]+$/g, "");
}

/**
 * 공백 차이를 무시하고 답안에서 인용 구간을 찾는다. 원문 기준 [시작, 끝)을 돌려준다.
 * 하이라이트에 원문 위치가 필요하므로 정규화 문자열 → 원문 위치 대응표를 만든다.
 */
export function findQuoteSpan(essay: string, quote: string): [number, number] | null {
  const q = trimQuote(quote).replace(/\s+/g, " ");
  if (q === "") return null;
  let norm = "";
  const map: number[] = []; // norm[i]가 원문 어디서 왔는지
  let prevSpace = false;
  for (let i = 0; i < essay.length; i++) {
    const ch = essay[i]!;
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      norm += " ";
      map.push(i);
      prevSpace = true;
    } else {
      norm += ch;
      map.push(i);
      prevSpace = false;
    }
  }
  const at = norm.indexOf(q);
  if (at < 0) return null;
  return [map[at]!, map[at + q.length - 1]! + 1];
}

/** 모델과 무관하게 코드가 다는 플래그 */
export function systemFlags(item: EssayItem, essay: string | null): SuggestionFlag[] {
  if (essay === null || essay.trim() === "") return ["empty"];
  const flags: SuggestionFlag[] = [];
  if (charCount(essay) > item.charLimit) flags.push("over-limit");
  if (instructionSpans(essay).length > 0) flags.push("injection-suspected");
  return flags;
}

/** 무응답 답안: 모델을 부르지 않고 모든 기준 0 제안을 만든다 */
export function emptySuggestion(item: EssayItem): ValidatedSuggestion {
  return {
    status: "valid",
    criteria: item.rubric.map((c) => ({ criterionId: c.id, level: 0, evidenceQuote: null, span: null, rationale: "답안이 없습니다.", issues: [] })),
    total: 0,
    feedbackDraft: "답안이 제출되지 않았습니다.",
    flags: ["empty"],
    problems: [],
  };
}

function invalid(item: EssayItem, essay: string, problems: string[]): ValidatedSuggestion {
  return { status: "invalid", criteria: [], total: 0, feedbackDraft: "", flags: systemFlags(item, essay), problems };
}

export function validateSuggestion(raw: unknown, item: EssayItem, essay: string): ValidatedSuggestion {
  if (!isObj(raw)) return invalid(item, essay, ["응답이 JSON 객체가 아닙니다."]);
  const problems: string[] = [];

  if (!Array.isArray(raw.criteria)) return invalid(item, essay, ["criteria 배열이 없습니다."]);
  if (typeof raw.feedbackDraft !== "string") problems.push("feedbackDraft가 문자열이 아닙니다.");
  else if (charCount(raw.feedbackDraft) > LIMITS.feedback) problems.push(`피드백이 ${LIMITS.feedback}자를 넘습니다.`);
  if (raw.flags !== undefined && !(Array.isArray(raw.flags) && raw.flags.every((f) => typeof f === "string"))) {
    problems.push("flags가 문자열 배열이 아닙니다.");
  }

  const byId = new Map(item.rubric.map((c) => [c.id, c]));
  const instructions = instructionSpans(essay);
  const seen = new Set<string>();
  const criteria: ValidatedCriterion[] = [];
  for (const [i, c] of raw.criteria.entries()) {
    if (!isObj(c)) {
      problems.push(`criteria[${i}]가 객체가 아닙니다.`);
      continue;
    }
    const id = c.criterionId;
    if (typeof id !== "string" || !byId.has(id)) {
      problems.push(`루브릭에 없는 기준입니다: ${String(id)}`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`기준이 중복되었습니다: ${id}`);
      continue;
    }
    seen.add(id);
    const level = c.level;
    const allowed = byId.get(id)!.levels.map((l) => l.level as number);
    if (typeof level !== "number" || !Number.isInteger(level) || !allowed.includes(level)) {
      problems.push(`${id}의 수준이 허용 범위(${allowed.join("·")})가 아닙니다: ${String(level)}`);
      continue;
    }
    if (typeof c.rationale !== "string") {
      problems.push(`${id}의 rationale이 문자열이 아닙니다.`);
      continue;
    }
    if (charCount(c.rationale) > LIMITS.rationale) {
      problems.push(`${id}의 설명이 ${LIMITS.rationale}자를 넘습니다.`);
      continue;
    }
    const q = c.evidenceQuote;
    if (q !== null && q !== undefined && typeof q !== "string") {
      problems.push(`${id}의 evidenceQuote가 문자열이 아닙니다.`);
      continue;
    }
    if (typeof q === "string" && charCount(q) > LIMITS.quote) {
      problems.push(`${id}의 근거 인용이 ${LIMITS.quote}자를 넘습니다.`);
      continue;
    }
    const quote = typeof q === "string" && trimQuote(q) !== "" ? q.trim() : null;
    const issues: CriterionIssue[] = [];
    let span: [number, number] | null = null;
    if (quote !== null) {
      span = findQuoteSpan(essay, quote);
      if (span === null) issues.push("quote-mismatch");
      else if (instructions.some(([a, b]) => span![0] < b && a < span![1])) issues.push("quote-in-instruction");
    } else if (level > 0) {
      issues.push("no-evidence");
    }
    criteria.push({ criterionId: id, level: level as RubricLevel, evidenceQuote: quote, span, rationale: c.rationale, issues });
  }
  for (const c of item.rubric) if (!seen.has(c.id)) problems.push(`기준이 빠졌습니다: ${c.id}`);

  if (problems.length > 0) return invalid(item, essay, problems);

  // 루브릭 순서로 정렬
  const order = new Map(item.rubric.map((c, i) => [c.id, i]));
  criteria.sort((a, b) => order.get(a.criterionId)! - order.get(b.criterionId)!);

  const modelFlags = ((raw.flags as string[] | undefined) ?? []).filter((f): f is ModelFlag => (MODEL_FLAGS as readonly string[]).includes(f));
  const flags: SuggestionFlag[] = [...new Set<SuggestionFlag>([...systemFlags(item, essay), ...modelFlags])];

  const review: string[] = [];
  for (const c of criteria) {
    if (c.issues.includes("quote-mismatch")) review.push(`${c.criterionId}: 근거 인용이 답안에 없습니다.`);
    if (c.issues.includes("no-evidence")) review.push(`${c.criterionId}: 수준 ${c.level}인데 근거 인용이 없습니다.`);
    if (c.issues.includes("quote-in-instruction")) review.push(`${c.criterionId}: 답안 속 채점 지시문을 근거로 인용했습니다.`);
  }
  if (flags.includes("injection-suspected")) review.push("답안에 채점 지시문이 들어 있을 수 있습니다.");

  return {
    status: review.length > 0 ? "needs-review" : "valid",
    criteria,
    total: criteria.reduce((s, c) => s + c.level, 0),
    feedbackDraft: raw.feedbackDraft as string,
    flags,
    problems: review,
  };
}
