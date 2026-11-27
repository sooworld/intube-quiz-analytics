// 계획서 항목을 활동이 쓰는 모양으로 꺼내는 순수 함수. 생성 스크립트·화면·테스트가 함께 쓴다.
// 못 찾는 항목은 조용히 넘기지 않고 오류를 낸다(활동 전용 목표 불허, docs/decisions.md U19).
import type { ForumObjective } from "../forum/types";
import type { Concept, ConceptId } from "../types";
import type { Syllabus, SyllabusItem, SyllabusScope } from "./types";

export function syllabusItem(syl: Syllabus, id: string): SyllabusItem | null {
  const c = syl.concepts.find((x) => x.id === id);
  if (c) return { type: "concept", ...c };
  const o = syl.objectives.find((x) => x.id === id);
  if (o) return { type: "objective", ...o };
  return null;
}

/** 퀴즈가 고른 개념을 요청한 순서대로 꺼낸다. 생성 JSON의 키 순서를 지키려고 객체를 새로 만든다 */
export function conceptsFrom(syl: Syllabus, ids: ConceptId[]): Concept[] {
  return ids.map((id) => {
    const c = syl.concepts.find((x) => x.id === id);
    if (!c) throw new Error(`계획서(${syl.courseId})에 개념 ${id}가 없습니다.`);
    return { id: c.id, name: c.name, description: c.description };
  });
}

/** 개념 id → 계획서 상세 (tag-draft-v2 입력). 계획서에 없는 개념은 빠진다 */
export function conceptDetails(syl: Syllabus, ids: ConceptId[]): Record<ConceptId, string> {
  const out: Record<ConceptId, string> = {};
  for (const id of ids) {
    const c = syl.concepts.find((x) => x.id === id);
    if (c) out[id] = c.detail;
  }
  return out;
}

/** 섹션 제목 "n주차: 주제" */
export function sectionTitle(syl: Syllabus, week: number): string {
  const w = syl.weeks.find((x) => x.week === week);
  if (!w) throw new Error(`계획서(${syl.courseId})에 ${week}주차가 없습니다.`);
  return `${week}주차: ${w.topic}`;
}

/** 토론 목표(O1…)를 계획서 목표에서 꺼낸다. id·kind·text는 계획서 그대로, syllabusId로 출처를 남긴다 */
export function forumObjectives(syl: Syllabus, refs: Record<string, string>): ForumObjective[] {
  const seen = new Set<string>();
  return Object.entries(refs).map(([alias, ref]) => {
    if (seen.has(alias)) throw new Error(`토론 목표 id가 겹칩니다: ${alias}`);
    seen.add(alias);
    const o = syl.objectives.find((x) => x.id === ref);
    if (!o) throw new Error(`계획서(${syl.courseId})에 목표 ${ref}가 없습니다 (${alias}).`);
    return { id: alias, kind: o.kind, text: o.text, syllabusId: o.id };
  });
}

/** 상세를 문장 단위로 쪼갠다(연관도 근거 후보). 마침표·물음표·느낌표 뒤 공백에서 자른다 */
export function detailSentences(detail: string): string[] {
  return detail
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** "5주차", "2·3주차", "강좌 전체" */
export function scopeLabel(scope: SyllabusScope | { kind: "weeks"; weeks: number[] }): string {
  if (scope.kind === "course") return "강좌 전체";
  return `${scope.weeks.join("·")}주차`;
}

export function itemScopeLabel(item: SyllabusItem): string {
  return item.type === "concept" ? scopeLabel({ kind: "weeks", weeks: item.weeks }) : scopeLabel(item.scope);
}

/** 링크 글자용 범위: 강좌 전체 역량 목표는 "강좌 역량", 나머지는 "5주차" 같은 주차 */
export function refScopeLabel(item: SyllabusItem): string {
  return item.type === "objective" && item.scope.kind === "course" ? "강좌 역량" : itemScopeLabel(item);
}

/** 항목 종류 이름: 개념 / 내용 목표 / 역량 목표 */
export function itemKindLabel(item: SyllabusItem): string {
  if (item.type === "concept") return "학습 개념";
  return item.kind === "content" ? "내용 목표" : "역량 목표";
}

// ── 링크 ──────────────────────────────────────────────────────────────────
// 강좌 홈 경로 분기를 한곳에 둔다. 첫 강좌(ALGO101)의 홈은 역사적으로 /courses/ 이다.

export const DEFAULT_COURSE_ID = "algo101";

export function courseHomeHref(courseId: string): string {
  return courseId === DEFAULT_COURSE_ID ? "/courses/" : `/courses/${courseId}/`;
}

export function sectionHref(courseId: string, sectionNumber: number): string {
  return `${courseHomeHref(courseId)}#sec-${sectionNumber}`;
}

/** 계획서 페이지. 항목 id를 주면 그 항목 카드(앵커 syl-<id>)로 간다 */
export function syllabusHref(courseId: string, itemId?: string): string {
  return `/courses/${courseId}/syllabus/${itemId ? `#${syllabusAnchor(itemId)}` : ""}`;
}

export function syllabusAnchor(itemId: string): string {
  return `syl-${itemId}`;
}

/** 계획서 주차 표의 그 주차 행. 항목 id와 겹치지 않게 접두어를 다르게 둔다 */
export function syllabusWeekAnchor(week: number): string {
  return `syl-week-${week}`;
}

export function syllabusWeekHref(courseId: string, week: number): string {
  return `${syllabusHref(courseId)}#${syllabusWeekAnchor(week)}`;
}
