// 응답 행렬: 응시 완료 학생 × 문항. 미응시 학생은 모든 분모에서 뺀다 (decisions.md §3).
import type { GradedState, Item, ItemId, Measure, QMatrix, QuizDataset, Student, StudentId } from "../types";

export interface ResponseMatrix {
  /** 응시 완료 학생 (id 오름차순) */
  students: Student[];
  notAttempted: Student[];
  items: Item[];
  state: Record<StudentId, Record<ItemId, GradedState>>;
  raw: Record<StudentId, Record<ItemId, string | null>>;
}

export function buildMatrix(ds: Pick<QuizDataset, "quiz" | "students" | "attempts" | "responses">): ResponseMatrix {
  const finishedAttempt = new Map<string, StudentId>();
  const finishedIds = new Set<StudentId>();
  for (const a of ds.attempts) {
    if (a.status === "finished") {
      finishedAttempt.set(a.id, a.studentId);
      finishedIds.add(a.studentId);
    }
  }
  const byId = (x: Student, y: Student) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  const students = ds.students.filter((s) => finishedIds.has(s.id)).sort(byId);
  const notAttempted = ds.students.filter((s) => !finishedIds.has(s.id)).sort(byId);
  const items = [...ds.quiz.items].sort((a, b) => a.number - b.number);

  const state: ResponseMatrix["state"] = {};
  const raw: ResponseMatrix["raw"] = {};
  for (const s of students) {
    state[s.id] = {};
    raw[s.id] = {};
    for (const it of items) {
      // 응답 기록이 없으면 무응답으로 본다
      state[s.id]![it.id] = "unanswered";
      raw[s.id]![it.id] = null;
    }
  }
  for (const r of ds.responses) {
    const sid = finishedAttempt.get(r.attemptId);
    if (!sid || !state[sid] || !(r.itemId in state[sid]!)) continue;
    state[sid]![r.itemId] = r.gradedState;
    raw[sid]![r.itemId] = r.rawAnswer;
  }
  return { students, notAttempted, items, state, raw };
}

/** 오답(무응답 포함) 여부 */
export function isWrong(m: ResponseMatrix, sid: StudentId, itemId: ItemId): boolean {
  return m.state[sid]?.[itemId] !== "correct";
}

export function wrongSet(m: ResponseMatrix, sid: StudentId, itemIds?: ItemId[]): Set<ItemId> {
  const ids = itemIds ?? m.items.map((i) => i.id);
  return new Set(ids.filter((id) => isWrong(m, sid, id)));
}

export function measure(numerator: number, denominator: number, evidenceItemIds: ItemId[]): Measure {
  return { value: denominator > 0 ? numerator / denominator : null, numerator, denominator, evidenceItemIds };
}

export function defaultQMatrix(items: Item[]): QMatrix {
  return Object.fromEntries(items.map((i) => [i.id, [...i.conceptIds]]));
}

/** 개념에 태그된 문항 (문항 번호 순) */
export function itemsForConcept(m: ResponseMatrix, q: QMatrix, conceptId: string): ItemId[] {
  return m.items.filter((i) => (q[i.id] ?? []).includes(conceptId)).map((i) => i.id);
}

/** Q-matrix의 안정적인 해시 (그룹 결정과 입력 버전을 연결할 때 쓴다) */
export function hashQMatrix(q: QMatrix): string {
  const canonical = Object.keys(q)
    .sort()
    .map((k) => `${k}:${[...(q[k] ?? [])].sort().join(",")}`)
    .join("|");
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) h = ((h << 5) + h + canonical.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** 문항 하나를 분석에서 뺀 행렬 (민감도 점검용) */
export function withoutItem(m: ResponseMatrix, itemId: ItemId): ResponseMatrix {
  return { ...m, items: m.items.filter((i) => i.id !== itemId) };
}
