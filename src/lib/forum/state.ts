// 토론 화면의 교수 기록 (이 브라우저 localStorage). 순수 함수만 둔다(복원 검증·테스트용).
// 원칙: 교수가 먼저 판단한다(F3). 도구 제안(규칙·AI 초안)은 불변으로 두고, 교수 확정은 따로 저장하며 바꾼 이력을 남긴다(Codex B0 검토 11).
import type { ValidatedPostProfile } from "../ai/tasks/forumProfile";
import { COMMON, type CellState, type Checklist, type PostAssignment } from "./analysis";
import { cellKey, type AssignmentTarget, type CellJudgment, type ForumDataset } from "./types";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const JUDGMENTS: CellJudgment[] = ["required", "optional", "none"];

// ── 교수 체크표 (설계 지도) ──

export interface TeacherChecklist {
  dataVersion: string;
  cells: Checklist;
  /** manual = 직접 표시, example = 설계자 예시로 채움, example-edited = 예시를 채운 뒤 고침 */
  source: "manual" | "example" | "example-edited";
  updatedAt: string | null;
}

export function emptyChecklist(dataVersion: string): TeacherChecklist {
  return { dataVersion, cells: {}, source: "manual", updatedAt: null };
}

export function validCellKeys(ds: ForumDataset): Set<string> {
  return new Set(ds.objectives.flatMap((o) => [...ds.subQuestions.map((q) => cellKey(o.id, q.id)), cellKey(o.id, COMMON)]));
}

export function restoreChecklist(raw: unknown, ds: ForumDataset): TeacherChecklist | null {
  if (!isObj(raw) || raw.dataVersion !== ds.dataVersion || !isObj(raw.cells) || !["manual", "example", "example-edited"].includes(raw.source as string)) return null;
  if (raw.updatedAt !== null && !isStr(raw.updatedAt)) return null;
  const keys = validCellKeys(ds);
  for (const [k, v] of Object.entries(raw.cells)) if (!keys.has(k) || !JUDGMENTS.includes(v as CellJudgment)) return null;
  return raw as unknown as TeacherChecklist;
}

/** 칸 하나를 다음 값으로 (미검토 → 무관 → 선택 → 필수 → 무관). 미검토로는 "모두 지우기"로만 돌아간다 */
export function cycleJudgment(j: CellState): CellJudgment {
  return j === "unset" ? "none" : j === "none" ? "optional" : j === "optional" ? "required" : "none";
}

export function setCell(cl: TeacherChecklist, key: string, j: CellJudgment, at: string): TeacherChecklist {
  const cells = { ...cl.cells, [key]: j } as Checklist;
  return { ...cl, cells, source: cl.source === "example" ? "example-edited" : cl.source, updatedAt: at };
}

/** 예시로 채우기: 설계자 예시 + 공통 요건. 적히지 않은 칸은 무관으로 채운다(모든 칸 판정) */
export function exampleChecklist(ds: ForumDataset, at: string): TeacherChecklist {
  const cells: Record<string, CellJudgment> = {};
  for (const k of validCellKeys(ds)) cells[k] = "none";
  for (const [k, v] of Object.entries(ds.exampleChecklist)) if (v) cells[k] = v;
  for (const [oid, v] of Object.entries(ds.commonRequirements)) if (v) cells[cellKey(oid, COMMON)] = v;
  return { dataVersion: ds.dataVersion, cells: cells as Checklist, source: "example", updatedAt: at };
}

/** 판정한(미검토가 아닌) 칸 수 */
export function markedCount(cl: TeacherChecklist): number {
  return Object.values(cl.cells).filter((v) => v !== undefined).length;
}

// ── 실행 전 예상 (논의 지도) ──

export interface Expectation {
  dataVersion: string;
  /** 가장 많이 다뤄졌을 하위 논점 */
  most: string | null;
  /** 거의 다뤄지지 않았을 하위 논점 */
  least: string | null;
  savedAt: string;
}

export function restoreExpectation(raw: unknown, ds: ForumDataset): Expectation | null {
  const qids = ds.subQuestions.map((q) => q.id);
  if (!isObj(raw) || raw.dataVersion !== ds.dataVersion || !isStr(raw.savedAt)) return null;
  for (const k of ["most", "least"] as const) if (raw[k] !== null && !qids.includes(raw[k] as string)) return null;
  return raw as unknown as Expectation;
}

// ── 교수 배정 확정 ──

export interface AssignmentValue {
  primary: AssignmentTarget;
  secondary: string[];
}

export interface AssignDecision extends AssignmentValue {
  /** 확정할 때 보고 있던 도구 제안 (없으면 null). 도구 제안은 따로 불변으로 남는다 */
  proposal: AssignmentValue | null;
  basedOnDraftId: string | null;
  decidedAt: string;
  /** 확정할 때 도구 제안을 화면에서 열어 본 상태였는지 (자동화 편향 측정용, 모르면 없음) */
  sawProposal?: boolean;
}

export interface AssignLogEntry {
  postId: string;
  from: AssignmentValue | null;
  to: AssignmentValue | null;
  basedOnDraftId: string | null;
  at: string;
}

export interface TeacherAssignments {
  dataVersion: string;
  decisions: Record<string, AssignDecision>;
  log: AssignLogEntry[];
}

export function emptyAssignments(dataVersion: string): TeacherAssignments {
  return { dataVersion, decisions: {}, log: [] };
}

function isTarget(x: unknown, ds: ForumDataset): x is AssignmentTarget {
  return isStr(x) && (ds.subQuestions.some((q) => q.id === x) || ["new", "off", "hold"].includes(x));
}

/** 부 배정은 Q일 때만, 최대 2개, 주 배정과 겹치지 않음 (Codex 구현 검토 3) */
export const MAX_SECONDARY = 2;

export function normalizeValue(v: AssignmentValue): AssignmentValue {
  if (!v.primary.startsWith("Q")) return { primary: v.primary, secondary: [] };
  return { primary: v.primary, secondary: [...new Set(v.secondary.filter((q) => q !== v.primary))].slice(0, MAX_SECONDARY) };
}

function isValue(x: unknown, ds: ForumDataset): x is AssignmentValue {
  if (!isObj(x) || !isTarget(x.primary, ds) || !Array.isArray(x.secondary) || !x.secondary.every((q) => ds.subQuestions.some((s) => s.id === q))) return false;
  if (x.secondary.length > MAX_SECONDARY || x.secondary.includes(x.primary)) return false;
  return (x.primary as string).startsWith("Q") || x.secondary.length === 0;
}

export function restoreAssignments(raw: unknown, ds: ForumDataset): TeacherAssignments | null {
  if (!isObj(raw) || raw.dataVersion !== ds.dataVersion || !isObj(raw.decisions) || !Array.isArray(raw.log)) return null;
  const postIds = new Set(ds.posts.map((p) => p.id));
  for (const [pid, d] of Object.entries(raw.decisions)) {
    if (!postIds.has(pid) || !isValue(d, ds) || !isObj(d)) return null;
    if (d.proposal !== null && !isValue(d.proposal, ds)) return null;
    if (d.basedOnDraftId !== null && !isStr(d.basedOnDraftId)) return null;
    if (!isStr(d.decidedAt)) return null;
    if (d.sawProposal !== undefined && typeof d.sawProposal !== "boolean") return null;
  }
  for (const e of raw.log) {
    if (!isObj(e) || !postIds.has(e.postId as string) || !isStr(e.at)) return null;
    if (e.from !== null && !isValue(e.from, ds)) return null;
    if (e.to !== null && !isValue(e.to, ds)) return null;
  }
  return raw as unknown as TeacherAssignments;
}

export function sameValue(a: AssignmentValue | null, b: AssignmentValue | null): boolean {
  if (a === null || b === null) return a === b;
  return a.primary === b.primary && [...a.secondary].sort().join(",") === [...b.secondary].sort().join(",");
}

/** 확정(또는 확정 취소: value=null). 바뀐 내용은 이력에 남긴다 */
export function decide(
  state: TeacherAssignments,
  postId: string,
  input: AssignmentValue | null,
  proposal: AssignmentValue | null,
  basedOnDraftId: string | null,
  at: string,
  sawProposal?: boolean,
): TeacherAssignments {
  const value = input === null ? null : normalizeValue(input);
  const prev = state.decisions[postId] ?? null;
  const decisions = { ...state.decisions };
  if (value === null) delete decisions[postId];
  else decisions[postId] = { ...value, proposal, basedOnDraftId, decidedAt: at, ...(sawProposal === undefined ? {} : { sawProposal }) };
  const from = prev ? { primary: prev.primary, secondary: prev.secondary } : proposal;
  const log = sameValue(from, value) && prev !== null ? state.log : [...state.log, { postId, from, to: value, basedOnDraftId, at }];
  return { ...state, decisions, log };
}

// ── 집계에 쓸 최종 배정 ──

export type AssignmentSource = "teacher" | "proposed" | "review" | "none";

export interface FinalAssignment extends PostAssignment {
  source: AssignmentSource;
}

/**
 * 글마다 집계에 쓸 배정: 교수 확정 > 도구 제안(검토 필요가 아니면) > 판단 보류.
 * 검토 필요(S6) 글은 교수가 확정하기 전까지 판단 보류로 센다.
 */
export function finalAssignments(ds: ForumDataset, profile: ValidatedPostProfile[] | null, decisions: Record<string, AssignDecision>): FinalAssignment[] {
  const byPost = new Map((profile ?? []).map((p) => [p.postId, p]));
  return ds.posts.map((p) => {
    const d = decisions[p.id];
    if (d) return { postId: p.id, primary: d.primary, secondary: d.secondary, source: "teacher" };
    const pr = byPost.get(p.id);
    if (!pr) return { postId: p.id, primary: "hold", secondary: [], source: "none" };
    if (pr.issues.length > 0) return { postId: p.id, primary: "hold", secondary: [], source: "review" };
    return { postId: p.id, primary: pr.primary, secondary: pr.secondary, source: "proposed" };
  });
}

export function sourceMix(xs: FinalAssignment[]): { teacher: number; proposed: number; review: number } {
  return {
    teacher: xs.filter((x) => x.source === "teacher").length,
    proposed: xs.filter((x) => x.source === "proposed").length,
    review: xs.filter((x) => x.source === "review").length,
  };
}

// ── 첨언 확인 표시 ──

export type CommentMark = "ok" | "wrong";

export interface CommentMarks {
  dataVersion: string;
  /** 초안 id → 항목 번호 → 표시 */
  byDraft: Record<string, Record<string, CommentMark>>;
}

export function restoreCommentMarks(raw: unknown, ds: ForumDataset): CommentMarks | null {
  if (!isObj(raw) || raw.dataVersion !== ds.dataVersion || !isObj(raw.byDraft)) return null;
  for (const m of Object.values(raw.byDraft)) {
    if (!isObj(m)) return null;
    for (const v of Object.values(m)) if (v !== "ok" && v !== "wrong") return null;
  }
  return raw as unknown as CommentMarks;
}
