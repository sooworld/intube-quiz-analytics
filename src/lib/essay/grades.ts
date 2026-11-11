// 서술형 채점 기록 (docs/decisions.md §6.3, 계획 T5). 순수 함수.
// - 제안은 누적되고 고치지 않는다
// - 확정은 근거 제안 id를 가리킨다. 다시 제안을 받아도 확정은 그대로다
// - 수락(accepted)은 valid 제안을 그대로 쓸 때만 가능하다
// - 다시 열면 이전 확정은 지우지 않고 이력(previousFinals)으로 옮긴다
import type { StoredSuggestion } from "../ai/types";
import type { CriterionLevels, EssayItem, EssayQuizDataset, RubricLevel } from "../types";

export type FinalSource = "accepted" | "edited" | "manual";

export interface FinalGrade {
  levels: CriterionLevels;
  feedback: string;
  source: FinalSource;
  basedOnSuggestionId?: string;
  decidedAt: string;
}

export interface GradeRecord {
  suggestions: StoredSuggestion[];
  final?: FinalGrade;
  /** 다시 열기 전에 있던 확정들(오래된 것부터). 분석에는 쓰지 않는다 */
  previousFinals?: FinalGrade[];
}

export interface EssayGradesState {
  dataVersion: string;
  records: Record<string, GradeRecord>;
}

export const recordKey = (attemptId: string, itemId: string) => `${attemptId}:${itemId}`;

export const emptyGrades = (dataVersion: string): EssayGradesState => ({ dataVersion, records: {} });

export class GradeActionError extends Error {}

export type GradeAction =
  | { type: "add-suggestion"; key: string; suggestion: StoredSuggestion }
  | { type: "finalize"; key: string; item: EssayItem; levels: CriterionLevels; feedback: string; source: FinalSource; basedOnSuggestionId?: string; decidedAt: string }
  | { type: "reopen"; key: string };

function sameLevels(a: CriterionLevels, b: CriterionLevels): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

export function suggestionLevels(s: StoredSuggestion): CriterionLevels {
  return Object.fromEntries(s.result.criteria.map((c) => [c.criterionId, c.level]));
}

export function latestSuggestion(rec: GradeRecord | undefined): StoredSuggestion | undefined {
  return rec?.suggestions[rec.suggestions.length - 1];
}

export function applyGradeAction(state: EssayGradesState, action: GradeAction): EssayGradesState {
  const rec: GradeRecord = state.records[action.key] ?? { suggestions: [] };
  switch (action.type) {
    case "add-suggestion": {
      if (rec.suggestions.some((s) => s.suggestionId === action.suggestion.suggestionId)) return state;
      return { ...state, records: { ...state.records, [action.key]: { ...rec, suggestions: [...rec.suggestions, action.suggestion] } } };
    }
    case "finalize": {
      const ids = action.item.rubric.map((c) => c.id).sort();
      const keys = Object.keys(action.levels).sort();
      if (ids.length !== keys.length || ids.some((id, i) => id !== keys[i])) throw new GradeActionError("모든 기준의 수준을 정해야 확정할 수 있습니다.");
      for (const v of Object.values(action.levels)) if (v !== 0 && v !== 1 && v !== 2) throw new GradeActionError("수준은 0·1·2만 가능합니다.");
      let basedOn: string | undefined;
      if (action.source !== "manual") {
        const s = rec.suggestions.find((x) => x.suggestionId === action.basedOnSuggestionId);
        if (!s) throw new GradeActionError("근거 제안을 찾을 수 없습니다.");
        if (s.result.status === "invalid") throw new GradeActionError("검증에 실패한 제안은 근거로 쓸 수 없습니다. 직접 채점하세요.");
        if (action.source === "accepted") {
          if (s.result.status !== "valid") throw new GradeActionError("검토가 필요한 제안은 그대로 수락할 수 없습니다. 확인 후 '수정 후 확정'을 쓰세요.");
          if (!sameLevels(action.levels, suggestionLevels(s))) throw new GradeActionError("수준을 바꿨다면 '수정 후 확정'을 쓰세요.");
        }
        basedOn = s.suggestionId;
      }
      const final: FinalGrade = { levels: { ...action.levels }, feedback: action.feedback, source: action.source, decidedAt: action.decidedAt, ...(basedOn ? { basedOnSuggestionId: basedOn } : {}) };
      return { ...state, records: { ...state.records, [action.key]: { ...rec, final } } };
    }
    case "reopen": {
      if (!rec.final) return state;
      const next: GradeRecord = { suggestions: rec.suggestions, previousFinals: [...(rec.previousFinals ?? []), rec.final] };
      return { ...state, records: { ...state.records, [action.key]: next } };
    }
  }
}

/** 확정 기록의 수준을 "수정 후 확정"인지 "수락"인지 판단할 때 쓴다 */
export function finalSourceFor(levels: CriterionLevels, s: StoredSuggestion | undefined): FinalSource {
  if (!s || s.result.status === "invalid") return "manual";
  return s.result.status === "valid" && sameLevels(levels, suggestionLevels(s)) ? "accepted" : "edited";
}

// ── 저장값 복원 검증 (useVersionedStorage의 validate) ──────────────────────────
// 구조만이 아니라 데이터셋과도 맞춰 본다: 없는 제출, 빠진 기준, 근거 제안이 없는 확정은 받지 않는다.
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isLevel = (x: unknown): x is RubricLevel => x === 0 || x === 1 || x === 2;

function levelsMatch(levels: unknown, item: EssayItem): boolean {
  if (!isObj(levels)) return false;
  const keys = Object.keys(levels).sort();
  const ids = item.rubric.map((c) => c.id).sort();
  return keys.length === ids.length && keys.every((k, i) => k === ids[i] && isLevel(levels[k]));
}

function validSuggestion(x: unknown, item: EssayItem): x is StoredSuggestion {
  if (!isObj(x) || typeof x.suggestionId !== "string" || typeof x.provider !== "string" || typeof x.model !== "string" || typeof x.inputHash !== "string" || typeof x.createdAt !== "string" || !isObj(x.result)) return false;
  const r = x.result;
  if (r.status !== "valid" && r.status !== "needs-review" && r.status !== "invalid") return false;
  if (!Array.isArray(r.criteria) || typeof r.feedbackDraft !== "string" || !Array.isArray(r.flags) || !Array.isArray(r.problems)) return false;
  if (r.status === "invalid") return true;
  const levels = Object.fromEntries(r.criteria.map((c) => (isObj(c) ? [c.criterionId, c.level] : ["", -1])));
  return r.criteria.length === item.rubric.length && levelsMatch(levels, item);
}

function validFinal(f: unknown, item: EssayItem, suggestionIds: Set<string>): f is FinalGrade {
  if (!isObj(f) || !levelsMatch(f.levels, item) || typeof f.feedback !== "string" || typeof f.decidedAt !== "string") return false;
  if (f.source === "manual") return f.basedOnSuggestionId === undefined || typeof f.basedOnSuggestionId === "string";
  if (f.source !== "accepted" && f.source !== "edited") return false;
  return typeof f.basedOnSuggestionId === "string" && suggestionIds.has(f.basedOnSuggestionId);
}

export function validateGradesState(raw: unknown, ds: EssayQuizDataset): EssayGradesState | null {
  if (!isObj(raw) || raw.dataVersion !== ds.dataVersion || !isObj(raw.records)) return null;
  const itemOf = new Map(ds.submissions.map((s) => [recordKey(s.attemptId, s.itemId), ds.quiz.items.find((i) => i.id === s.itemId)!]));
  for (const [key, rec] of Object.entries(raw.records)) {
    const item = itemOf.get(key);
    if (!item || !isObj(rec) || !Array.isArray(rec.suggestions) || !rec.suggestions.every((s) => validSuggestion(s, item))) return null;
    const ids = new Set((rec.suggestions as StoredSuggestion[]).map((s) => s.suggestionId));
    if (rec.final !== undefined && !validFinal(rec.final, item, ids)) return null;
    if (rec.previousFinals !== undefined && !(Array.isArray(rec.previousFinals) && rec.previousFinals.every((f) => validFinal(f, item, ids)))) return null;
  }
  return raw as unknown as EssayGradesState;
}
