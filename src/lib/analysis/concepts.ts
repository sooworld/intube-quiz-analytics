// 개념 관찰 오답률 (D1: 틀린 문항은 태그된 모든 개념에 똑같이 반영).
// 값은 "관찰된 오답 비율"이며 개념 숙달 확률이 아니다.
import type { Concept, ConceptId, Measure, QMatrix, StudentId } from "../types";
import { isWrong, itemsForConcept, measure, type ResponseMatrix } from "./matrix";

/** 학생 한 명의 개념 오답률. evidenceItemIds = 그 학생이 틀린 태그 문항. */
export function studentConcept(m: ResponseMatrix, q: QMatrix, sid: StudentId, conceptId: ConceptId): Measure {
  const tagged = itemsForConcept(m, q, conceptId);
  const wrong = tagged.filter((id) => isWrong(m, sid, id));
  return measure(wrong.length, tagged.length, wrong);
}

/** 학급 전체의 개념 오답률. evidenceItemIds = 태그 문항 전체. */
export function classConcept(m: ResponseMatrix, q: QMatrix, conceptId: ConceptId): Measure {
  const tagged = itemsForConcept(m, q, conceptId);
  let wrong = 0;
  for (const s of m.students) for (const id of tagged) if (isWrong(m, s.id, id)) wrong++;
  return measure(wrong, tagged.length * m.students.length, tagged);
}

export interface ConceptTable {
  concepts: Concept[];
  classRow: Record<ConceptId, Measure>;
  rows: { studentId: StudentId; cells: Record<ConceptId, Measure> }[];
}

export function conceptTable(m: ResponseMatrix, q: QMatrix, concepts: Concept[]): ConceptTable {
  return {
    concepts,
    classRow: Object.fromEntries(concepts.map((c) => [c.id, classConcept(m, q, c.id)])),
    rows: m.students.map((s) => ({
      studentId: s.id,
      cells: Object.fromEntries(concepts.map((c) => [c.id, studentConcept(m, q, s.id, c.id)])),
    })),
  };
}

export interface ReviewPriority {
  conceptId: ConceptId;
  student: Measure;
  /** 보조 정보: 학급 오답률 */
  classValue: number | null;
}

/**
 * 개인 복습 우선순위: 개인 관찰 오답률 내림차순, 같으면 오답 문항 수 내림차순, 그다음 개념 순서.
 * 오답이 없는 개념과 자료 없는 개념은 뺀다. 학급 대비 차이는 정렬에 쓰지 않는다.
 */
export function reviewPriorities(m: ResponseMatrix, q: QMatrix, concepts: Concept[], sid: StudentId): ReviewPriority[] {
  return concepts
    .map((c, order) => ({ order, conceptId: c.id, student: studentConcept(m, q, sid, c.id), classValue: classConcept(m, q, c.id).value }))
    .filter((r) => r.student.value !== null && r.student.numerator > 0)
    .sort((a, b) => b.student.value! - a.student.value! || b.student.numerator - a.student.numerator || a.order - b.order)
    .map(({ conceptId, student, classValue }) => ({ conceptId, student, classValue }));
}
