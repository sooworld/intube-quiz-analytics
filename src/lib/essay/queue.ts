// 서술형 채점 화면(AI 우선 배치)의 순수 로직: 대기열 상태·필터·다음 답안·확정 내용.
// 확정 출처의 정의(finalSourceFor)는 grades.ts 그대로 쓴다(docs/decisions.md §6.3·§6.4).
import type { StoredSuggestion } from "../ai/types";
import type { CriterionLevels } from "../types";
import { finalSourceFor, latestSuggestion, suggestionLevels, type FinalSource, type GradeRecord } from "./grades";

export type RowStatus = "final" | "review" | "invalid" | "suggested" | "none";

export function rowStatus(rec: GradeRecord | undefined): RowStatus {
  if (rec?.final) return "final";
  const s = latestSuggestion(rec);
  if (!s) return "none";
  return s.result.status === "valid" ? "suggested" : s.result.status === "needs-review" ? "review" : "invalid";
}

/** 확정 전(기본) · 검토 필요(검토 필요 + 검증 실패) · 전체 · 확정. id는 RowStatus와 겹치지 않게 둔다(건수를 한 객체에 센다) */
export type QueueFilter = "open" | "attention" | "all" | "done";

export const QUEUE_FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "open", label: "확정 전" },
  { id: "attention", label: "검토 필요" },
  { id: "all", label: "전체" },
  { id: "done", label: "확정" },
];

export function matchesFilter(status: RowStatus, filter: QueueFilter): boolean {
  switch (filter) {
    case "open":
      return status !== "final";
    case "attention":
      return status === "review" || status === "invalid";
    case "all":
      return true;
    case "done":
      return status === "final";
  }
}

export type QueueCounts = Record<RowStatus, number> & Record<QueueFilter, number>;

export function queueCounts(statuses: RowStatus[]): QueueCounts {
  const c: QueueCounts = { final: 0, review: 0, invalid: 0, suggested: 0, none: 0, open: 0, attention: 0, all: 0, done: 0 };
  for (const s of statuses) {
    c[s]++;
    for (const f of QUEUE_FILTERS) if (matchesFilter(s, f.id)) c[f.id]++;
  }
  return c;
}

/**
 * 필터를 적용한 행. 지금 보고 있는 답안은 필터와 무관하게 선택을 유지하고,
 * 필터에 걸려 숨겨졌으면 hiddenSelected로 알린다(목록 위에 따로 고정해 보여 준다).
 */
export function filterQueue<T extends { key: string; status: RowStatus }>(rows: T[], filter: QueueFilter, selectedKey: string): { visible: T[]; hiddenSelected: T | null } {
  const visible = rows.filter((r) => matchesFilter(r.status, filter));
  const selected = rows.find((r) => r.key === selectedKey) ?? null;
  return { visible, hiddenSelected: selected && !visible.includes(selected) ? selected : null };
}

export interface QueueTarget {
  itemId: string;
  key: string;
}

/**
 * 확정 뒤 "다음 답안": 같은 문항에서 지금 답안 다음의 미확정 답안(끝에 닿으면 처음부터),
 * 없으면 지금 문항 다음 문항부터 순환하며 첫 미확정 답안. 모두 확정이면 null.
 * order는 문항 순서와 문항별 제출 키(명단 순서)다.
 */
export function nextTarget(order: { itemId: string; keys: string[] }[], current: QueueTarget, isFinal: (key: string) => boolean): QueueTarget | null {
  const at = order.findIndex((o) => o.itemId === current.itemId);
  if (at < 0) return null;
  const keys = order[at]!.keys;
  const i = keys.indexOf(current.key);
  const sameItem = [...keys.slice(i + 1), ...keys.slice(0, Math.max(i, 0))].filter((k) => k !== current.key);
  const here = sameItem.find((k) => !isFinal(k));
  if (here) return { itemId: current.itemId, key: here };
  for (let step = 1; step < order.length; step++) {
    const o = order[(at + step) % order.length]!;
    const k = o.keys.find((x) => !isFinal(x));
    if (k) return { itemId: o.itemId, key: k };
  }
  return null;
}

/** 수락: 검증 통과(valid) 제안만, 수준을 그대로 쓸 때 */
export function canAccept(usable: StoredSuggestion | undefined): usable is StoredSuggestion {
  return usable?.result.status === "valid";
}

/** review: 제안을 근거로 수락·수정, manual: 직접 채점(근거 제안을 떼어 낸다) */
export type DecisionMode = "review" | "manual";

/**
 * 확정에 넣을 출처와 근거 제안. 직접 채점은 제안이 있어도 manual이고 근거 제안이 없다.
 * (제안을 그대로 둔 채 수준만 비우면 finalSourceFor가 수락·수정으로 분류하므로 모드로 구분한다)
 */
export function decideFinal(mode: DecisionMode, levels: CriterionLevels, usable: StoredSuggestion | undefined): { source: FinalSource; basedOnSuggestionId?: string } {
  if (mode === "manual" || !usable) return { source: "manual" };
  const source = finalSourceFor(levels, usable);
  return source === "manual" ? { source } : { source, basedOnSuggestionId: usable.suggestionId };
}

/** 수락 버튼이 확정할 수준 (제안 수준 그대로) */
export function acceptLevels(usable: StoredSuggestion): CriterionLevels {
  return suggestionLevels(usable);
}
