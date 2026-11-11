// 근거 보기 검사 (docs/xapi-plan.md P2): 근거 건수가 화면 숫자와 다르면 실패한다.
import { describe, expect, it } from "vitest";
import quizDef from "@/data/quiz-w5.json";
import rosterFile from "@/data/roster.json";
import statementsFile from "../public/xapi/quiz-w5.statements.json";
import { classConcept, studentConcept } from "@/lib/analysis/concepts";
import { allItemStats, totalScore } from "@/lib/analysis/itemStats";
import { buildMatrix, defaultQMatrix } from "@/lib/analysis/matrix";
import type { QMatrix } from "@/lib/types";
import { collectEvidence, evidenceNumerator, evidenceTotal } from "@/lib/xapi/evidence";
import { toQuizDataset, type QuizDefinitionFile } from "@/lib/xapi/toDataset";
import type { XStatement } from "@/lib/xapi/vocab";

const statements = statementsFile as unknown as XStatement[];
const { dataset: ds, sources } = toQuizDataset(quizDef as QuizDefinitionFile, rosterFile.students, statements);
const byId = new Map(statements.map((s) => [s.id, s]));
const m = buildMatrix(ds);
const allItems = m.items.map((i) => i.id);
const ev = (itemIds: string[], studentIds?: string[], map = byId) => collectEvidence(ds, sources, map, { itemIds, studentIds });

const defaultQ = defaultQMatrix(ds.quiz.items);
const conceptIds = ds.quiz.concepts.map((c) => c.id);
/** 교수가 편집한 Q-matrix: 첫 문항 태그 제거, 둘째 문항에 모든 개념, 나머지는 첫 개념을 마지막 개념으로 바꿈 */
const editedQ: QMatrix = Object.fromEntries(
  ds.quiz.items.map((it, i) => [
    it.id,
    i === 0 ? [] : i === 1 ? [...conceptIds] : it.conceptIds.map((c) => (c === conceptIds[0] ? conceptIds.at(-1)! : c)),
  ]),
);
const tagged = (q: QMatrix, cid: string) => allItems.filter((id) => (q[id] ?? []).includes(cid));

describe("문항 정답률 근거", () => {
  it.each(allItemStats(m).map((s) => [s.itemId, s] as const))("%s: 정답 = 분자, 정답 + 오답 + 없음 = 분모", (itemId, stat) => {
    const e = ev([itemId]);
    expect(evidenceNumerator(e, "correct")).toBe(stat.facility.numerator);
    expect(evidenceTotal(e)).toBe(stat.facility.denominator);
    expect(e.missing).toHaveLength(stat.unanswered);
  });

  it("정답·오답 근거는 모두 실제 answered Statement이고, 없음 칸은 Statement가 없다", () => {
    const e = ev(allItems);
    for (const r of [...e.correct, ...e.incorrect]) {
      expect(r.statement!.verb.id).toBe("http://adlnet.gov/expapi/verbs/answered");
      expect(r.statement!.actor.account.name).toBe(r.studentId);
    }
    for (const r of e.missing) expect(m.state[r.studentId]![r.itemId]).toBe("unanswered");
    expect(e.correct.length + e.incorrect.length).toBe(statements.filter((s) => s.verb.id.endsWith("/answered")).length);
  });
});

describe.each([
  ["기본 Q-matrix", defaultQ],
  ["편집한 Q-matrix", editedQ],
])("개념 오답률 근거 (%s)", (_, q) => {
  it.each(conceptIds)("%s 학급 행: 오답 + 없음 = 분자, 합 = 분모", (cid) => {
    const k = classConcept(m, q, cid);
    const e = ev(tagged(q, cid));
    expect(evidenceNumerator(e, "wrong")).toBe(k.numerator);
    expect(evidenceTotal(e)).toBe(k.denominator);
  });

  it.each(conceptIds)("%s 학생 셀 전체", (cid) => {
    for (const s of m.students) {
      const cell = studentConcept(m, q, s.id, cid);
      const e = ev(tagged(q, cid), [s.id]);
      expect(evidenceNumerator(e, "wrong")).toBe(cell.numerator);
      expect(evidenceTotal(e)).toBe(cell.denominator);
    }
  });
});

describe("학생 상세 응답 근거", () => {
  it("학생마다 정답 = 점수, 합 = 문항 수", () => {
    for (const s of m.students) {
      const e = ev(allItems, [s.id]);
      expect(evidenceNumerator(e, "correct")).toBe(totalScore(m, s.id));
      expect(evidenceTotal(e)).toBe(m.items.length);
    }
  });
});

describe("미응시와 민감도", () => {
  it("미응시 학생은 분모에서 빠진다", () => {
    expect(m.notAttempted.length).toBeGreaterThan(0);
    expect(evidenceTotal(ev(allItems, m.notAttempted.map((s) => s.id)))).toBe(0);
    expect(evidenceTotal(ev(allItems))).toBe(m.students.length * m.items.length);
  });

  it("Statement 하나의 정오가 바뀌면 근거 건수가 화면 숫자와 달라진다", () => {
    const stat = allItemStats(m)[0]!;
    const target = ev([stat.itemId]).correct[0]!.statement!;
    const tampered = new Map(byId).set(target.id, { ...target, result: { ...target.result, success: false } });
    expect(evidenceNumerator(ev([stat.itemId], undefined, tampered), "correct")).not.toBe(stat.facility.numerator);
  });
});
