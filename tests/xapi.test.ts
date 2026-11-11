// xAPI 원천 전환 검사 (docs/xapi-plan.md P1)
import { describe, expect, it } from "vitest";
import v1 from "./fixtures/quiz-w5.v1.json";
import quizDef from "@/data/quiz-w5.json";
import rosterFile from "@/data/roster.json";
import statementsFile from "../public/xapi/quiz-w5.statements.json";
import report from "../public/xapi/quiz-w5.validation.json";
import { getDataset } from "@/lib/data";
import { sourceKey, toQuizDataset, XapiConversionError, type QuizDefinitionFile } from "@/lib/xapi/toDataset";
import { EXT, VERB, type XStatement } from "@/lib/xapi/vocab";
import { validateStatements } from "../scripts/shared/xapiValidate";

const def = quizDef as QuizDefinitionFile;
const roster = rosterFile.students;
const statements = statementsFile as unknown as XStatement[];
const convert = (ss: XStatement[]) => toQuizDataset(def, roster, ss);

describe("원천 전환 동일성", () => {
  it("Statement에서 만든 데이터셋이 전환 전(v1) 데이터와 같다", () => {
    expect(getDataset("quiz-w5")).toEqual(v1);
  });

  it("퀴즈 정의와 dataVersion이 바뀌지 않았다 (저장된 태그·그룹안·AI 초안 basisHash 유지)", () => {
    expect(def.quiz).toEqual(v1.quiz);
    expect(def.dataVersion).toBe(v1.dataVersion);
  });
});

describe("Statement 형식", () => {
  it("모든 Statement가 검증을 통과한다 (xAPI 1.0.3 기준)", () => {
    expect(validateStatements(statements)).toEqual([]);
    expect(report.problemCount).toBe(0);
    expect(report.statementCount).toBe(statements.length);
  });

  it("id가 중복되지 않고, LRS가 정하는 필드를 넣지 않는다", () => {
    expect(new Set(statements.map((s) => s.id)).size).toBe(statements.length);
    for (const s of statements) {
      expect(s.stored).toBeUndefined();
      expect(s.authority).toBeUndefined();
      expect(s.version).toBeUndefined();
    }
  });

  it("success와 score.raw가 일치하고, 무응답은 answered가 없다", () => {
    const answered = statements.filter((s) => s.verb.id === VERB.answered);
    for (const s of answered) expect(s.result!.score!.raw).toBe(s.result!.success ? 1 : 0);
    const unanswered = v1.responses.filter((r) => r.rawAnswer === null).length;
    expect(answered).toHaveLength(v1.responses.length - unanswered);
  });

  it("시간 순서: 시작 ≤ 응답 ≤ 완료 ≤ 마감", () => {
    const close = Date.parse(def.quiz.closeDate);
    const byReg = new Map<string, XStatement[]>();
    for (const s of statements) byReg.set(s.context!.registration!, [...(byReg.get(s.context!.registration!) ?? []), s]);
    expect(byReg.size).toBe(v1.attempts.filter((a) => a.status === "finished").length);
    for (const ss of byReg.values()) {
      const at = (verb: string) => ss.filter((s) => s.verb.id === verb).map((s) => Date.parse(s.timestamp!));
      const [start] = at(VERB.attempted);
      const [end] = at(VERB.completed);
      for (const t of at(VERB.answered)) {
        expect(t).toBeGreaterThanOrEqual(start!);
        expect(t).toBeLessThanOrEqual(end!);
      }
      expect(end!).toBeLessThanOrEqual(close);
    }
  });
});

describe("변환기", () => {
  it("근거 대응표: 응답한 문항마다 answered 1건, 무응답은 없음", () => {
    const { dataset, sources } = convert(statements);
    const byId = new Map(statements.map((s) => [s.id, s]));
    for (const r of dataset.responses) {
      const sid = sources.get(sourceKey(r.attemptId, r.itemId));
      if (r.rawAnswer === null) expect(sid).toBeUndefined();
      else expect(byId.get(sid!)!.result!.response).toBe(r.rawAnswer);
    }
  });

  it("void된 Statement는 없는 것으로 본다 (LRS 조회처럼 빠져 있어도 같은 결과)", () => {
    const target = statements.find((s) => s.verb.id === VERB.answered)!;
    const voiding: XStatement = {
      id: "00000000-0000-4000-8000-000000000001",
      actor: target.actor,
      verb: { id: VERB.voided },
      object: { objectType: "StatementRef", id: target.id },
    };
    const withVoid = convert([...statements, voiding]).dataset;
    const removed = convert(statements.filter((s) => s.id !== target.id)).dataset;
    expect(withVoid).toEqual(removed);
    const attemptId = target.context!.extensions![EXT.attemptId] as string;
    const r = withVoid.responses.find((x) => x.attemptId === attemptId && x.itemId === target.object.id.split("/").pop());
    expect(r?.gradedState).toBe("unanswered");
  });

  it("LRS가 붙인 stored·authority·version이 있어도 결과가 같다", () => {
    const fromLrs = statements.map((s) => ({ ...s, stored: "2026-11-10T00:00:00Z", authority: { objectType: "Agent", account: { homePage: "x", name: "y" } }, version: "2.0.0" }));
    expect(convert(fromLrs).dataset).toEqual(convert(statements).dataset);
  });

  it("같은 응시·문항에 유효한 answered가 2건이면 조용히 고르지 않고 멈춘다", () => {
    const dup = { ...statements.find((s) => s.verb.id === VERB.answered)!, id: "00000000-0000-4000-8000-000000000002" };
    expect(() => convert([...statements, dup])).toThrow(XapiConversionError);
  });

  it("완료 Statement가 없으면 미응시로 본다", () => {
    const completedS01 = statements.find((s) => s.verb.id === VERB.completed && s.actor.account.name === "s01")!;
    const ds = convert(statements.filter((s) => s.id !== completedS01.id)).dataset;
    expect(ds.attempts.find((a) => a.studentId === "s01")).toEqual({ id: "a-s01", studentId: "s01", status: "notattempted" });
    expect(ds.responses.some((r) => r.attemptId === "a-s01")).toBe(false);
  });
});
