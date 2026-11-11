// 서술형 채점 AI 우선 배치의 순수 로직 (대기열·다음 답안·확정 출처).
import { describe, expect, it } from "vitest";
import w5e from "@/data/quiz-w5e.json";
import type { StoredSuggestion, SuggestionStatus } from "@/lib/ai/types";
import { applyGradeAction, emptyGrades, type GradeRecord } from "@/lib/essay/grades";
import { acceptLevels, canAccept, decideFinal, filterQueue, matchesFilter, nextTarget, queueCounts, rowStatus, type RowStatus } from "@/lib/essay/queue";
import type { CriterionLevels, EssayQuizDataset } from "@/lib/types";

const ds = w5e as unknown as EssayQuizDataset;
const E1 = ds.quiz.items.find((i) => i.id === "e1")!;
const LEVELS: CriterionLevels = Object.fromEntries(E1.rubric.map((c, i) => [c.id, (i % 3) as 0 | 1 | 2]));

function suggestion(status: SuggestionStatus, id = `sg-${status}`, levels: CriterionLevels = LEVELS): StoredSuggestion {
  return {
    suggestionId: id,
    provider: "lg",
    model: "k-exaone_v2.5",
    promptVersion: "p",
    schemaVersion: "s",
    validatorVersion: "v",
    inputHash: "h",
    createdAt: "2026-11-11T00:00:00Z",
    result: {
      status,
      criteria: status === "invalid" ? [] : E1.rubric.map((c) => ({ criterionId: c.id, level: levels[c.id]!, evidenceQuote: null, span: null, rationale: "", issues: [] })),
      total: Object.values(levels).reduce<number>((a, b) => a + b, 0),
      feedbackDraft: "",
      flags: [],
      problems: [],
    },
  };
}

describe("대기열 상태와 필터", () => {
  it("행 상태: 확정 > 최신 제안 상태 > 미제안", () => {
    expect(rowStatus(undefined)).toBe("none");
    expect(rowStatus({ suggestions: [suggestion("valid")] })).toBe("suggested");
    expect(rowStatus({ suggestions: [suggestion("valid"), suggestion("needs-review")] })).toBe("review");
    expect(rowStatus({ suggestions: [suggestion("invalid")] })).toBe("invalid");
    const fin: GradeRecord = { suggestions: [suggestion("invalid")], final: { levels: LEVELS, feedback: "", source: "manual", decidedAt: "t" } };
    expect(rowStatus(fin)).toBe("final");
  });

  it("필터: 확정 전·검토 필요(검토 필요+검증 실패)·전체·확정, 건수는 필터마다 센다", () => {
    const statuses: RowStatus[] = ["final", "review", "invalid", "suggested", "none", "none"];
    const c = queueCounts(statuses);
    expect(c).toEqual({ final: 1, review: 1, invalid: 1, suggested: 1, none: 2, open: 5, attention: 2, all: 6, done: 1 });
    expect(matchesFilter("invalid", "attention")).toBe(true);
    expect(matchesFilter("suggested", "attention")).toBe(false);
    expect(matchesFilter("final", "open")).toBe(false);
  });

  it("지금 보는 답안이 필터에 걸리면 숨김 행으로 따로 알리고, 선택은 바꾸지 않는다", () => {
    const rows = [
      { key: "a", status: "final" as RowStatus },
      { key: "b", status: "none" as RowStatus },
    ];
    const r = filterQueue(rows, "open", "a");
    expect(r.visible.map((x) => x.key)).toEqual(["b"]);
    expect(r.hiddenSelected?.key).toBe("a");
    expect(filterQueue(rows, "all", "a").hiddenSelected).toBeNull();
  });
});

describe("다음 답안", () => {
  const order = [
    { itemId: "e1", keys: ["a1", "b1", "c1"] },
    { itemId: "e2", keys: ["a2", "b2", "c2"] },
    { itemId: "e3", keys: ["a3"] },
  ];
  const finals = (...keys: string[]) => (k: string) => keys.includes(k);

  it("같은 문항에서 다음 미확정 → 끝이면 처음부터 순환", () => {
    expect(nextTarget(order, { itemId: "e1", key: "a1" }, finals("a1"))).toEqual({ itemId: "e1", key: "b1" });
    expect(nextTarget(order, { itemId: "e1", key: "c1" }, finals("c1", "b1"))).toEqual({ itemId: "e1", key: "a1" });
  });

  it("같은 문항이 모두 확정이면 '다음' 문항부터 순환하고, 그 문항의 이미 확정된 답안은 건너뛴다", () => {
    // 회귀 방지: 첫 미완료 문항(e1)으로 가거나 그 문항의 첫 답안(a2, 이미 확정)을 고르던 문제
    expect(nextTarget(order, { itemId: "e2", key: "c2" }, finals("a2", "b2", "c2"))).toEqual({ itemId: "e3", key: "a3" });
    expect(nextTarget(order, { itemId: "e1", key: "a1" }, finals("a1", "b1", "c1", "a2"))).toEqual({ itemId: "e2", key: "b2" });
    expect(nextTarget(order, { itemId: "e3", key: "a3" }, finals("a3", "a1"))).toEqual({ itemId: "e1", key: "b1" });
  });

  it("지금 답안이 미확정이어도 자기 자신은 고르지 않고, 모두 확정이면 null", () => {
    expect(nextTarget(order, { itemId: "e3", key: "a3" }, finals("a1", "b1", "c1", "a2", "b2", "c2"))).toBeNull();
    expect(nextTarget(order, { itemId: "e1", key: "a1" }, () => true)).toBeNull();
  });
});

describe("확정 출처 (수락·수정·직접 채점)", () => {
  const valid = suggestion("valid");
  const review = suggestion("needs-review");
  const changed: CriterionLevels = { ...LEVELS, [E1.rubric[0]!.id]: ((LEVELS[E1.rubric[0]!.id]! + 1) % 3) as 0 | 1 | 2 };

  it("수락은 valid 제안에서만", () => {
    expect(canAccept(valid)).toBe(true);
    expect(canAccept(review)).toBe(false);
    expect(canAccept(undefined)).toBe(false);
    expect(decideFinal("review", acceptLevels(valid), valid)).toEqual({ source: "accepted", basedOnSuggestionId: valid.suggestionId });
  });

  it("수정: 수준을 바꾸면 edited, needs-review는 그대로여도 edited", () => {
    expect(decideFinal("review", changed, valid)).toEqual({ source: "edited", basedOnSuggestionId: valid.suggestionId });
    expect(decideFinal("review", LEVELS, review)).toEqual({ source: "edited", basedOnSuggestionId: review.suggestionId });
  });

  it("직접 채점은 제안이 있어도 manual이고 근거 제안을 떼어 낸다(수준이 제안과 같아도)", () => {
    expect(decideFinal("manual", LEVELS, valid)).toEqual({ source: "manual" });
    expect(decideFinal("manual", changed, valid)).toEqual({ source: "manual" });
    expect(decideFinal("review", LEVELS, undefined)).toEqual({ source: "manual" });
  });

  it("decideFinal 결과는 기록 규칙(applyGradeAction)을 통과한다", () => {
    const key = "a-s01:e1";
    let s = applyGradeAction(emptyGrades("v"), { type: "add-suggestion", key, suggestion: valid });
    for (const [levels, mode] of [
      [acceptLevels(valid), "review"],
      [changed, "review"],
      [LEVELS, "manual"],
    ] as const) {
      const d = decideFinal(mode, levels, valid);
      const next = applyGradeAction(s, { type: "finalize", key, item: E1, levels, feedback: "", ...d, decidedAt: "t" });
      expect(next.records[key]!.final!.source).toBe(d.source);
      expect(next.records[key]!.final!.basedOnSuggestionId).toBe(d.basedOnSuggestionId);
      s = applyGradeAction(next, { type: "reopen", key });
    }
  });
});
