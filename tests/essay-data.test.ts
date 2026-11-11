// 서술형 예시 데이터 계약 검사 (docs/decisions.md §6, 계획 Phase 2)
import { describe, expect, it } from "vitest";
import courseFile from "@/data/course.json";
import { getDataset } from "@/lib/data";
import w5e from "@/data/quiz-w5e.json";
import type { Course, EssayQuizDataset } from "@/lib/types";

const ds = w5e as unknown as EssayQuizDataset;
const quizW5 = getDataset("quiz-w5")!;
const len = (t: string | null) => (t === null ? 0 : [...t].length);

describe("quiz-w5e 데이터", () => {
  it("학생·응시가 quiz-w5와 같다 (26명, 미응시 1명)", () => {
    expect(ds.students).toEqual(quizW5.students);
    expect(ds.attempts).toEqual(quizW5.attempts);
    expect(ds.attempts.filter((a) => a.status === "notattempted")).toHaveLength(1);
  });

  it("응시 완료 학생마다 모든 문항 제출이 하나씩 있고, 미응시 학생 제출은 없다", () => {
    const finished = ds.attempts.filter((a) => a.status === "finished").map((a) => a.id);
    expect(ds.submissions).toHaveLength(finished.length * ds.quiz.items.length);
    const keys = new Set(ds.submissions.map((s) => `${s.attemptId}:${s.itemId}`));
    expect(keys.size).toBe(ds.submissions.length);
    for (const s of ds.submissions) expect(finished).toContain(s.attemptId);
  });

  it("모든 제출에 모든 기준의 기준 채점(0·1·2)이 있다", () => {
    for (const s of ds.submissions) {
      const ref = ds.referenceGrades.find((r) => r.attemptId === s.attemptId && r.itemId === s.itemId);
      expect(ref, `${s.attemptId}:${s.itemId}`).toBeDefined();
      const item = ds.quiz.items.find((i) => i.id === s.itemId)!;
      expect(Object.keys(ref!.levels).sort()).toEqual(item.rubric.map((c) => c.id).sort());
      for (const v of Object.values(ref!.levels)) expect([0, 1, 2]).toContain(v);
    }
  });

  it("문항 만점은 기준 수 × 2이고 루브릭 개념은 퀴즈 개념 안에 있다", () => {
    const conceptIds = ds.quiz.concepts.map((c) => c.id);
    for (const item of ds.quiz.items) {
      expect(item.maxScore).toBe(item.rubric.length * 2);
      for (const c of item.rubric) {
        expect(c.levels.map((l) => l.level)).toEqual([0, 1, 2]);
        for (const id of c.conceptIds) expect(conceptIds).toContain(id);
      }
    }
  });

  it("보류 답안은 문항마다 3편, 모두 6편이다", () => {
    const holdout = ds.referenceGrades.filter((r) => r.origin === "holdout");
    expect(holdout).toHaveLength(6);
    for (const item of ds.quiz.items) expect(holdout.filter((r) => r.itemId === item.id)).toHaveLength(3);
  });

  it("경계 사례가 들어 있다", () => {
    const texts = ds.submissions.map((s) => s.text);
    // 무응답 1건, 기준 채점은 모두 0
    const empty = ds.submissions.filter((s) => s.text === null);
    expect(empty).toHaveLength(1);
    const emptyRef = ds.referenceGrades.find((r) => r.attemptId === empty[0]!.attemptId && r.itemId === empty[0]!.itemId)!;
    expect(Object.values(emptyRef.levels).every((v) => v === 0)).toBe(true);
    // 지시문 주입
    expect(texts.filter((t) => t?.includes("이전 지시를 모두 무시"))).toHaveLength(1);
    // 매우 짧은 답 (30자 미만)
    expect(texts.filter((t) => t !== null && len(t) < 30).length).toBeGreaterThanOrEqual(1);
    // 글자 수 초과는 정확히 1건
    const over = ds.submissions.filter((s) => {
      const item = ds.quiz.items.find((i) => i.id === s.itemId)!;
      return len(s.text) > item.charLimit;
    });
    expect(over).toHaveLength(1);
    // 거의 같은 답안 1쌍 ("따라서" ↔ "그러므로" 한 군데)
    const e1 = ds.submissions.filter((s) => s.itemId === "e1" && s.text).map((s) => s.text!);
    const pairs = e1.filter((a) => e1.some((b) => a !== b && a.replace("그러므로", "따라서") === b));
    expect(pairs).toHaveLength(1);
  });

  it("과정 홈 5주차에 서술형 퀴즈 링크가 있다", () => {
    const sec5 = (courseFile.course as Course).sections.find((s) => s.number === 5)!;
    expect(sec5.activities.find((a) => a.id === ds.quiz.id)?.href).toBe(`/essay/${ds.quiz.id}/`);
  });
});
