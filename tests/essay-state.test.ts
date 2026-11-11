// 채점 기록·지표·키 보관 테스트 (계획 Phase 4 상태 전이)
import { describe, expect, it } from "vitest";
import w5e from "@/data/quiz-w5e.json";
import { createAiSettingsStore, SESSION_KEY, SETTINGS_KEY, type StorageLike } from "@/lib/ai/keyStore";
import type { StoredSuggestion, SuggestionStatus } from "@/lib/ai/types";
import { applyGradeAction, emptyGrades, finalSourceFor, GradeActionError, recordKey, validateGradesState, type EssayGradesState } from "@/lib/essay/grades";
import { aiVsFinal, aiVsReference, confirmation, conceptScoreRates, levelDistribution } from "@/lib/essay/metrics";
import type { CriterionLevels, EssayQuizDataset } from "@/lib/types";

const ds = w5e as unknown as EssayQuizDataset;
const E1 = ds.quiz.items.find((i) => i.id === "e1")!;
const sub = ds.submissions.find((s) => s.itemId === "e1" && s.text)!;
const KEY = recordKey(sub.attemptId, "e1");
const T = "2026-11-10T00:00:00.000Z";

function sug(id: string, levels: [number, number, number], status: SuggestionStatus = "valid"): StoredSuggestion {
  return {
    suggestionId: id,
    provider: "mock",
    model: "rules-v1",
    promptVersion: "p",
    schemaVersion: "1",
    validatorVersion: "1",
    inputHash: "h",
    createdAt: T,
    result: {
      status,
      criteria: status === "invalid" ? [] : E1.rubric.map((c, i) => ({ criterionId: c.id, level: levels[i] as 0 | 1 | 2, evidenceQuote: null, span: null, rationale: "", issues: [] })),
      total: levels.reduce((a, b) => a + b, 0),
      feedbackDraft: "fb",
      flags: [],
      problems: [],
    },
  };
}
const lv = (a: number, b: number, c: number): CriterionLevels => ({ "e1-fix": a as 0, "e1-bigo": b as 0, "e1-tradeoff": c as 0 });
const add = (st: EssayGradesState, s: StoredSuggestion, key = KEY) => applyGradeAction(st, { type: "add-suggestion", key, suggestion: s });
const fin = (st: EssayGradesState, levels: CriterionLevels, source: "accepted" | "edited" | "manual", based?: string, key = KEY) =>
  applyGradeAction(st, { type: "finalize", key, item: E1, levels, feedback: "f", source, basedOnSuggestionId: based, decidedAt: T });

describe("채점 기록 전이", () => {
  it("valid 제안은 그대로 수락할 수 있다", () => {
    const st = fin(add(emptyGrades(ds.dataVersion), sug("s1", [2, 1, 0])), lv(2, 1, 0), "accepted", "s1");
    expect(st.records[KEY]!.final).toMatchObject({ source: "accepted", basedOnSuggestionId: "s1" });
  });

  it("invalid 제안은 근거로 쓸 수 없다 (직접 채점만)", () => {
    const st = add(emptyGrades(ds.dataVersion), sug("bad", [0, 0, 0], "invalid"));
    expect(() => fin(st, lv(0, 0, 0), "accepted", "bad")).toThrow(GradeActionError);
    expect(() => fin(st, lv(1, 0, 0), "edited", "bad")).toThrow(GradeActionError);
    expect(fin(st, lv(1, 0, 0), "manual").records[KEY]!.final!.basedOnSuggestionId).toBeUndefined();
  });

  it("needs-review 제안은 수락할 수 없고 수정 후 확정만 된다", () => {
    const st = add(emptyGrades(ds.dataVersion), sug("r", [2, 2, 2], "needs-review"));
    expect(() => fin(st, lv(2, 2, 2), "accepted", "r")).toThrow(/검토/);
    expect(fin(st, lv(2, 2, 2), "edited", "r").records[KEY]!.final!.source).toBe("edited");
  });

  it("수준을 바꾸고 '수락'이라고 하면 막는다", () => {
    const st = add(emptyGrades(ds.dataVersion), sug("s1", [2, 1, 0]));
    expect(() => fin(st, lv(2, 2, 0), "accepted", "s1")).toThrow(/수정 후 확정/);
  });

  it("빠진 기준이 있으면 확정할 수 없다", () => {
    expect(() => fin(emptyGrades(ds.dataVersion), { "e1-fix": 1 }, "manual")).toThrow(/모든 기준/);
  });

  it("다시 제안을 받아도 확정과 그 근거는 그대로다", () => {
    let st = fin(add(emptyGrades(ds.dataVersion), sug("s1", [2, 1, 0])), lv(2, 1, 0), "accepted", "s1");
    st = add(st, sug("s2", [0, 0, 0]));
    expect(st.records[KEY]!.suggestions.map((s) => s.suggestionId)).toEqual(["s1", "s2"]);
    expect(st.records[KEY]!.final).toMatchObject({ basedOnSuggestionId: "s1", levels: lv(2, 1, 0) });
  });

  it("같은 제안을 두 번 넣어도 한 번만 남는다(불변 이력)", () => {
    const s = sug("s1", [1, 1, 1]);
    expect(add(add(emptyGrades(ds.dataVersion), s), s).records[KEY]!.suggestions).toHaveLength(1);
  });

  it("다시 열면 확정을 이력으로 옮기고 제안 이력은 남긴다", () => {
    const st = applyGradeAction(fin(add(emptyGrades(ds.dataVersion), sug("s1", [1, 1, 1])), lv(1, 1, 1), "accepted", "s1"), { type: "reopen", key: KEY });
    expect(st.records[KEY]!.final).toBeUndefined();
    expect(st.records[KEY]!.suggestions).toHaveLength(1);
    expect(st.records[KEY]!.previousFinals).toEqual([expect.objectContaining({ source: "accepted", levels: lv(1, 1, 1) })]);
    // 다시 확정하고 또 열면 이력이 쌓인다
    const again = applyGradeAction(fin(st, lv(2, 1, 1), "edited", "s1"), { type: "reopen", key: KEY });
    expect(again.records[KEY]!.previousFinals!.map((f) => f.source)).toEqual(["accepted", "edited"]);
  });

  it("확정 출처 추정", () => {
    expect(finalSourceFor(lv(2, 1, 0), sug("a", [2, 1, 0]))).toBe("accepted");
    expect(finalSourceFor(lv(2, 2, 0), sug("a", [2, 1, 0]))).toBe("edited");
    expect(finalSourceFor(lv(2, 1, 0), sug("a", [2, 1, 0], "needs-review"))).toBe("edited");
    expect(finalSourceFor(lv(2, 1, 0), sug("a", [2, 1, 0], "invalid"))).toBe("manual");
    expect(finalSourceFor(lv(2, 1, 0), undefined)).toBe("manual");
  });

  it("저장값 복원: dataVersion·구조·데이터셋과 맞지 않으면 버린다", () => {
    const st = applyGradeAction(fin(add(emptyGrades(ds.dataVersion), sug("s1", [2, 1, 0])), lv(2, 1, 0), "accepted", "s1"), { type: "reopen", key: KEY });
    const ok = fin(st, lv(2, 1, 0), "accepted", "s1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rt = (): any => JSON.parse(JSON.stringify(ok));
    expect(validateGradesState(rt(), ds)).toEqual(ok);
    expect(validateGradesState(rt(), { ...ds, dataVersion: "old" })).toBeNull();
    expect(validateGradesState({ dataVersion: ds.dataVersion }, ds)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (mutate: (x: any) => void) => {
      const x = rt();
      mutate(x);
      return validateGradesState(x, ds);
    };
    expect(bad((x) => (x.records[KEY].final.levels["e1-fix"] = 5))).toBeNull(); // 범위 밖
    expect(bad((x) => (x.records[KEY].final.levels = {}))).toBeNull(); // 기준 누락 — 확정으로 세면 안 된다
    expect(bad((x) => delete x.records[KEY].final.levels["e1-tradeoff"])).toBeNull();
    expect(bad((x) => (x.records[KEY].final.basedOnSuggestionId = "없는-제안"))).toBeNull(); // 근거 제안 없음
    expect(bad((x) => (x.records["a-s99:e1"] = { suggestions: [] }))).toBeNull(); // 없는 제출
    expect(bad((x) => (x.records[KEY].previousFinals[0].levels = {}))).toBeNull();
    expect(bad((x) => (x.records[KEY].suggestions[0].result.criteria = []))).toBeNull(); // 유효 제안인데 기준 없음
  });
});

describe("서술형 지표", () => {
  const keyB = recordKey(ds.submissions.filter((s) => s.itemId === "e1")[1]!.attemptId, "e1");

  it("아무것도 확정하지 않으면 확정률 0/50이고 개념 점수율은 자료 없음", () => {
    const st = emptyGrades(ds.dataVersion);
    expect(confirmation(ds, st)).toEqual({ numerator: 0, denominator: ds.submissions.length, value: 0 });
    for (const r of conceptScoreRates(ds, st)) expect(r.rate.value).toBeNull();
  });

  it("확정 전 제안은 분석에 들어가지 않는다", () => {
    const st = add(emptyGrades(ds.dataVersion), sug("s1", [2, 2, 2]));
    expect(levelDistribution(ds, st)["e1-fix"]).toEqual([0, 0, 0]);
    expect(aiVsFinal(ds, st).overall.pairs).toBe(0);
  });

  it("AI vs 확정: 유효 제안에 연결된 확정만 비교하고 출처별로 센다", () => {
    let st = emptyGrades(ds.dataVersion);
    st = fin(add(st, sug("a", [2, 1, 0])), lv(2, 1, 0), "accepted", "a"); // 3쌍 일치
    st = fin(add(st, sug("b", [2, 2, 2], "needs-review"), keyB), lv(0, 2, 1), "edited", "b", keyB); // 차이 2, 0, 1
    const k3 = recordKey(ds.submissions.filter((s) => s.itemId === "e1")[2]!.attemptId, "e1");
    st = fin(add(st, sug("c", [0, 0, 0], "invalid"), k3), lv(1, 1, 1), "manual", undefined, k3); // 비교 제외
    const r = aiVsFinal(ds, st);
    expect(r.bySource).toEqual({ accepted: 1, edited: 1, manual: 1 });
    expect(r.linkedFinals).toBe(2);
    expect(r.overall.pairs).toBe(6);
    expect(r.overall.exact).toMatchObject({ numerator: 4, denominator: 6 });
    expect(r.overall.within1).toMatchObject({ numerator: 5, denominator: 6 });
    expect(r.overall.mae).toBeCloseTo(3 / 6);
    expect(r.overall.over).toBe(2);
    expect(r.overall.under).toBe(0);
    expect(r.byCriterion["e1-fix"]!.exact).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it("개념 점수율 = 확정 기준 점수 합 / 최대점수 합", () => {
    const st = fin(emptyGrades(ds.dataVersion), lv(2, 1, 0), "manual");
    const rates = Object.fromEntries(conceptScoreRates(ds, st).map((r) => [r.conceptId, r.rate]));
    expect(rates["c-reg"]).toMatchObject({ numerator: 2, denominator: 4 }); // e1-fix + e1-tradeoff
    expect(rates["c-hyp"]).toMatchObject({ numerator: 1, denominator: 2 });
    expect(rates["c-clu"]!.value).toBeNull();
  });

  it("AI vs 기준 채점: 제공자·모델별로 나누고, 생성/보류를 나누고, invalid 제안은 건너뛴다", () => {
    const holdout = ds.referenceGrades.find((r) => r.origin === "holdout" && r.itemId === "e1")!;
    const hk = recordKey(holdout.attemptId, "e1");
    const levels = holdout.levels;
    let st = add(emptyGrades(ds.dataVersion), sug("h", [levels["e1-fix"]!, levels["e1-bigo"]!, levels["e1-tradeoff"]!]), hk);
    st = add(st, sug("bad", [0, 0, 0], "invalid"), hk); // 최신이 invalid면 그 이전 유효 제안을 쓴다
    st = add(st, { ...sug("g", [0, 0, 0]), provider: "gemini", model: "gm" }, hk);
    const r = aiVsReference(ds, st);
    expect(r.map((g) => g.provider + "|" + g.model)).toEqual(["gemini|gm", "mock|rules-v1"]);
    const mock = r.find((g) => g.provider === "mock")!;
    expect(mock.submissions).toEqual({ generated: 0, holdout: 1 });
    expect(mock.holdout.exact).toMatchObject({ numerator: 3, denominator: 3 });
    expect(mock.generated.exact.value).toBeNull();
    expect(r.find((g) => g.provider === "gemini")!.holdout.pairs).toBe(3); // 섞이지 않고 따로 센다
  });
});

describe("개인 키 보관", () => {
  function mem(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  }

  it("기본은 메모리: 키가 어떤 저장소에도 쓰이지 않는다", () => {
    const local = mem();
    const session = mem();
    const s = createAiSettingsStore({ local, session });
    s.hydrate();
    s.setProvider("gemini");
    s.setKey("AIza-secret");
    expect(s.getSnapshot().hasKey).toBe(true);
    expect(s.getConfig().apiKey).toBe("AIza-secret");
    expect([...local.data.values(), ...session.data.values()].join()).not.toContain("AIza-secret");
    expect(JSON.stringify(s.getSnapshot())).not.toContain("AIza-secret");
  });

  it("작업별 모델: 공통 설정을 따르거나, Mock, 같은 제공자의 다른 모델을 쓴다. 제공자가 다르면 막고, 설정은 복원된다", () => {
    const local = mem();
    const session = mem();
    const s = createAiSettingsStore({ local, session });
    s.hydrate();
    s.setProvider("gemini");
    s.setModel("gemini-3.5-flash-lite");
    s.setKey("k-task");
    expect(s.getConfigFor("tag-draft")).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash-lite", apiKey: "k-task" });
    s.setTaskSetting("analysis-summary", { provider: "gemini", model: "gemini-3.5-flash" });
    s.setTaskSetting("relation-draft", { provider: "mock" });
    expect(s.getConfigFor("analysis-summary")).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash", apiKey: "k-task" });
    expect(s.getConfigFor("relation-draft")).toEqual({ provider: "mock", model: "rules-v1" });
    expect(local.data.get(SETTINGS_KEY)).not.toContain("k-task");
    s.setProvider("anthropic");
    expect(() => s.getConfigFor("analysis-summary")).toThrow(/공통 제공자/);
    const b = createAiSettingsStore({ local, session });
    b.hydrate();
    expect(b.getSnapshot().tasks).toEqual({ "analysis-summary": { provider: "gemini", model: "gemini-3.5-flash" }, "relation-draft": { provider: "mock" } });
    b.setTaskSetting("analysis-summary", null);
    expect(b.getSnapshot().tasks["analysis-summary"]).toBeUndefined();
  });

  it("sessionStorage를 고르면 그 탭에서 복원되고, localStorage에는 절대 쓰지 않는다", () => {
    const local = mem();
    const session = mem();
    const a = createAiSettingsStore({ local, session });
    a.hydrate();
    a.setProvider("gemini");
    a.setKey("k1");
    a.setPersist("session");
    expect(session.data.get(SESSION_KEY)).toContain("k1");
    expect(local.data.get(SETTINGS_KEY)).not.toContain("k1");
    const b = createAiSettingsStore({ local, session });
    b.hydrate();
    expect(b.getConfig()).toMatchObject({ provider: "gemini", apiKey: "k1" });
    expect(b.getSnapshot().persist).toBe("session");
  });

  it("제공자나 주소를 바꾸면 키를 비운다(메모리·세션 모두)", () => {
    const session = mem();
    const s = createAiSettingsStore({ local: mem(), session });
    s.hydrate();
    s.setProvider("openai");
    s.setKey("k");
    s.setPersist("session");
    s.setBaseUrl("https://other.example/v1");
    expect(s.getSnapshot().hasKey).toBe(false);
    expect(session.data.has(SESSION_KEY)).toBe(false);
    s.setKey("k2");
    s.setProvider("gemini");
    expect(s.getConfig().apiKey).toBeUndefined();
  });

  it("세션에 남은 키가 지금 제공자와 다르면 복원하지 않고 지운다", () => {
    const local = mem();
    const session = mem();
    local.setItem(SETTINGS_KEY, JSON.stringify({ provider: "anthropic", models: {}, baseUrl: "" }));
    session.setItem(SESSION_KEY, JSON.stringify({ provider: "gemini", baseUrl: "", key: "k" }));
    const s = createAiSettingsStore({ local, session });
    s.hydrate();
    expect(s.getSnapshot().hasKey).toBe(false);
    expect(session.data.has(SESSION_KEY)).toBe(false);
  });

  it("키 지우기와 메모리로 되돌리기", () => {
    const session = mem();
    const s = createAiSettingsStore({ local: mem(), session });
    s.hydrate();
    s.setProvider("gemini");
    s.setKey("k");
    s.setPersist("session");
    s.setPersist("memory");
    expect(session.data.has(SESSION_KEY)).toBe(false);
    expect(s.getSnapshot().hasKey).toBe(true);
    s.clearKey();
    expect(s.getSnapshot().hasKey).toBe(false);
  });

  it("저장소가 예외를 던져도 동작하고 경고를 보여 준다", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const s = createAiSettingsStore({ local: broken, session: broken });
    s.hydrate();
    s.setProvider("gemini");
    s.setKey("k");
    s.setPersist("session");
    expect(s.getConfig().apiKey).toBe("k");
    expect(s.getSnapshot().storageWarning).not.toBeNull();
  });

  it("모델은 제공자별로 기억하고 기본값이 있다", () => {
    const s = createAiSettingsStore({ local: mem(), session: mem() });
    s.hydrate();
    s.setProvider("anthropic");
    expect(s.getSnapshot().model).toBe("claude-opus-5-5");
    s.setModel("claude-haiku-5-5");
    s.setProvider("gemini");
    s.setProvider("anthropic");
    expect(s.getSnapshot().model).toBe("claude-haiku-5-5");
  });
});
