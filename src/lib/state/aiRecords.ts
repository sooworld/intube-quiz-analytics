// AI 초안·반영 기록의 저장 계약 (docs/decisions.md §8.2). 순수 함수만 둔다(복원 검증·테스트용).
// 초안은 불변·누적이고, 확정 기록(태그 출처·관계·요약)은 근거 초안 id를 가리킨다.
import type { AiTaskId } from "../ai/task";
import { isProviderId, type ProviderId, type SuggestionStatus } from "../ai/types";
import { detectCycle, type RelationType } from "../analysis/relations";
import type { ConceptId, ItemId } from "../types";

export type DraftTaskId = Exclude<AiTaskId, "essay-grade">;

export interface AiDraft<I = unknown, V extends { status: SuggestionStatus } = { status: SuggestionStatus }> {
  draftId: string;
  task: DraftTaskId;
  quizId: string;
  dataVersion: string;
  provider: ProviderId;
  requestedModel: string;
  responseModel: string | null;
  promptVersion: string;
  schemaVersion: string;
  validatorVersion: string;
  /** 작업 입력의 최신성. 지금 입력과 다르면 반영을 막는다 */
  basisHash: string;
  /** 당시 근거를 다시 읽는 데 필요한 입력 */
  input: I;
  createdAt: string;
  result: V;
}

export interface StoredDrafts {
  dataVersion: string;
  drafts: AiDraft[];
  /** 읽을 수 없는 기록. 지우지 않고 그대로 보존한다 */
  unreadable: unknown[];
}

export type TagProvenanceSource = "default" | "ai" | "ai-edited" | "manual";

export interface ItemProvenance {
  source: TagProvenanceSource;
  basedOnDraftId?: string;
}

export type QProvenance = Record<ItemId, ItemProvenance>;

export interface ConfirmedRelation {
  id: string;
  from: ConceptId;
  to: ConceptId;
  type: RelationType;
  rationale: string;
  fromItemIds: ItemId[];
  toItemIds: ItemId[];
  source: "ai" | "ai-edited" | "manual";
  basedOnDraftId?: string;
  confirmedAt: string;
}

export interface StoredRelations {
  dataVersion: string;
  relations: ConfirmedRelation[];
}

/** 묶음 그룹이 쓴 관계의 스냅숏 (이것이 지금 확정 관계와 다르면 그 그룹안만 재검토) */
export interface RelationSnapshot {
  id: string;
  from: ConceptId;
  to: ConceptId;
  type: RelationType;
}

export interface SummaryFinal {
  dataVersion: string;
  basedOnDraftId: string;
  basisHash: string;
  sections: { heading: string; sentences: string[] }[];
  savedAt: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string";
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const TASKS: DraftTaskId[] = ["tag-draft", "relation-draft", "analysis-summary"];
const STATUSES: SuggestionStatus[] = ["valid", "needs-review", "invalid"];

export function isAiDraft(x: unknown): x is AiDraft {
  if (!isObj(x)) return false;
  return (
    isStr(x.draftId) &&
    TASKS.includes(x.task as DraftTaskId) &&
    isStr(x.quizId) &&
    isStr(x.dataVersion) &&
    isProviderId(x.provider) &&
    isStr(x.requestedModel) &&
    (x.responseModel === null || isStr(x.responseModel)) &&
    isStr(x.promptVersion) &&
    isStr(x.schemaVersion) &&
    isStr(x.validatorVersion) &&
    isStr(x.basisHash) &&
    "input" in x &&
    isStr(x.createdAt) &&
    isObj(x.result) &&
    STATUSES.includes(x.result.status as SuggestionStatus)
  );
}

/**
 * 초안 저장소 복원. 형식이 틀린 항목은 버리지 않고 unreadable로 옮겨 보존한다.
 * 데이터 버전이 다른 초안도 지우지 않는다(근거 기록이므로). 화면은 지금 dataVersion의 초안만 쓴다.
 */
export function restoreDrafts(raw: unknown, dataVersion: string): StoredDrafts | null {
  if (!isObj(raw) || !Array.isArray(raw.drafts)) return null;
  const drafts: AiDraft[] = [];
  const unreadable: unknown[] = Array.isArray(raw.unreadable) ? [...raw.unreadable] : [];
  for (const d of raw.drafts) (isAiDraft(d) ? drafts : unreadable).push(d as AiDraft);
  return { dataVersion, drafts, unreadable };
}

export function restoreProvenance(raw: unknown, itemIds: Iterable<ItemId>): QProvenance | null {
  const out: QProvenance = {};
  const src = isObj(raw) ? raw : {};
  for (const id of itemIds) {
    const p = src[id];
    if (p === undefined) {
      out[id] = { source: "default" };
      continue;
    }
    if (!isObj(p) || !["default", "ai", "ai-edited", "manual"].includes(p.source as string)) return null;
    if (p.basedOnDraftId !== undefined && !isStr(p.basedOnDraftId)) return null;
    out[id] = p.basedOnDraftId ? { source: p.source as TagProvenanceSource, basedOnDraftId: p.basedOnDraftId } : { source: p.source as TagProvenanceSource };
  }
  return out;
}

export function defaultProvenance(itemIds: Iterable<ItemId>): QProvenance {
  return Object.fromEntries([...itemIds].map((id) => [id, { source: "default" as const }]));
}

/** 체크 칸을 직접 바꿨을 때의 출처 */
export function editedProvenance(p: ItemProvenance | undefined): ItemProvenance {
  if (p && (p.source === "ai" || p.source === "ai-edited")) return { source: "ai-edited", basedOnDraftId: p.basedOnDraftId };
  return { source: "manual" };
}

export function restoreRelations(raw: unknown, dataVersion: string, conceptIds: Set<string>, itemIds: Set<string>): StoredRelations | null {
  if (!isObj(raw) || raw.dataVersion !== dataVersion || !Array.isArray(raw.relations)) return null;
  const relations: ConfirmedRelation[] = [];
  for (const r of raw.relations) {
    if (
      !isObj(r) ||
      !isStr(r.id) ||
      !conceptIds.has(r.from as string) ||
      !conceptIds.has(r.to as string) ||
      r.from === r.to ||
      !["prerequisite", "related", "confusable"].includes(r.type as string) ||
      !isStr(r.rationale) ||
      !isStrArr(r.fromItemIds) ||
      !isStrArr(r.toItemIds) ||
      ![...r.fromItemIds, ...r.toItemIds].every((id) => itemIds.has(id)) ||
      !["ai", "ai-edited", "manual"].includes(r.source as string) ||
      (r.basedOnDraftId !== undefined && !isStr(r.basedOnDraftId)) ||
      !isStr(r.confirmedAt)
    ) {
      return null;
    }
    relations.push(r as unknown as ConfirmedRelation);
  }
  // 저장 규칙: 같은 쌍 중복 없음, 선수 관계 순환 없음
  const pairs = new Set(relations.map((r) => [r.from, r.to].sort().join("|")));
  if (pairs.size !== relations.length || detectCycle(relations)) return null;
  return { dataVersion, relations };
}

export function relationSnapshot(r: ConfirmedRelation): RelationSnapshot {
  return { id: r.id, from: r.from, to: r.to, type: r.type };
}

/** 스냅숏이 지금 확정 관계와 모두 같은지 */
export function snapshotsCurrent(snaps: RelationSnapshot[], current: ConfirmedRelation[]): boolean {
  const byId = new Map(current.map((r) => [r.id, r]));
  return snaps.every((s) => {
    const r = byId.get(s.id);
    return !!r && r.from === s.from && r.to === s.to && r.type === s.type;
  });
}

export function restoreSummaryFinal(raw: unknown, dataVersion: string): SummaryFinal | null {
  if (!isObj(raw) || raw.dataVersion !== dataVersion || !isStr(raw.basedOnDraftId) || !isStr(raw.basisHash) || !isStr(raw.savedAt) || !Array.isArray(raw.sections)) return null;
  for (const s of raw.sections) if (!isObj(s) || !isStr(s.heading) || !isStrArr(s.sentences)) return null;
  return raw as unknown as SummaryFinal;
}
