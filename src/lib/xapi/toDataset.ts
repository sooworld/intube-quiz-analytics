// xAPI Statement → QuizDataset 변환기 (docs/xapi-plan.md §3.3).
// 분석 함수는 이 결과만 받는다. 응답마다 출처 Statement id를 함께 돌려주어 근거 보기가 같은 규칙을 다시 구현하지 않게 한다.
import type { Attempt, GradedState, Quiz, QuizDataset, Response, Student } from "../types";
import { EXT, itemIri, quizIri, VERB, type XStatement } from "./vocab";

export interface QuizDefinitionFile {
  dataVersion: string;
  quiz: Quiz;
}

export interface ConvertedQuiz {
  dataset: QuizDataset;
  /** "attemptId:itemId" → answered Statement id. 무응답은 항목이 없다 */
  sources: Map<string, string>;
  /** attemptId → 응시 시작·완료 Statement id */
  attemptSources: Map<string, { attempted?: string; completed: string }>;
}

export class XapiConversionError extends Error {}

export const sourceKey = (attemptId: string, itemId: string) => `${attemptId}:${itemId}`;

const parentIds = (s: XStatement) => (s.context?.contextActivities?.parent ?? []).map((a) => a.id);

/**
 * 규칙
 * - voided Statement가 가리키는 Statement는 없는 것으로 본다 (LRS 조회 결과처럼 void가 빠져 있어도 같은 결과)
 * - 응시 완료 = 퀴즈 Activity에 대한 completed. 시작만 하고 완료하지 않은 응시는 분석하지 않는다 (decisions §3)
 * - 응시 id는 확장 키에서 읽는다. 명단에 있고 완료 응시가 없으면 미응시(`a-<학생 id>`)
 * - 문항마다 answered가 없으면 무응답, 2건 이상이면 오류
 * - LRS가 붙이는 stored·authority·version은 쓰지 않는다
 */
export function toQuizDataset(def: QuizDefinitionFile, roster: Student[], statements: XStatement[]): ConvertedQuiz {
  const { quiz } = def;
  const qIri = quizIri(quiz.courseId, quiz.id);
  const itemByIri = new Map(quiz.items.map((it) => [itemIri(quiz.courseId, quiz.id, it.id), it.id]));

  const voided = new Set(
    statements.filter((s) => s.verb.id === VERB.voided && s.object.objectType === "StatementRef").map((s) => s.object.id),
  );
  const live = statements.filter((s) => s.verb.id !== VERB.voided && !voided.has(s.id));

  const attemptIdOf = (s: XStatement): string => {
    const v = s.context?.extensions?.[EXT.attemptId];
    if (typeof v !== "string") throw new XapiConversionError(`Statement ${s.id}: 응시 id 확장 키가 없다`);
    return v;
  };

  // 학생 → 완료 응시 (registration 기준)
  const completedByStudent = new Map<string, { attemptId: string; registration: string; completed: string }>();
  const attemptedByReg = new Map<string, string>();
  for (const s of live) {
    if (s.object.id !== qIri || !s.context?.registration) continue;
    if (s.verb.id === VERB.attempted) attemptedByReg.set(s.context.registration, s.id);
    if (s.verb.id === VERB.completed) {
      const sid = s.actor.account.name;
      if (completedByStudent.has(sid)) throw new XapiConversionError(`학생 ${sid}: 완료 응시가 2건 이상이다 (학생당 1회 전제, decisions §2)`);
      completedByStudent.set(sid, { attemptId: attemptIdOf(s), registration: s.context.registration, completed: s.id });
    }
  }

  // registration → 문항 → answered
  const answers = new Map<string, Map<string, XStatement>>();
  for (const s of live) {
    if (s.verb.id !== VERB.answered || !parentIds(s).includes(qIri)) continue;
    const reg = s.context?.registration;
    const itemId = itemByIri.get(s.object.id);
    if (!reg || !itemId) throw new XapiConversionError(`Statement ${s.id}: registration 또는 문항을 알 수 없다`);
    const byItem = answers.get(reg) ?? new Map<string, XStatement>();
    if (byItem.has(itemId)) throw new XapiConversionError(`registration ${reg}, 문항 ${itemId}: 유효한 answered가 2건 이상이다`);
    byItem.set(itemId, s);
    answers.set(reg, byItem);
  }

  const attempts: Attempt[] = [];
  const responses: Response[] = [];
  const sources = new Map<string, string>();
  const attemptSources = new Map<string, { attempted?: string; completed: string }>();

  for (const st of roster) {
    const done = completedByStudent.get(st.id);
    if (!done) {
      attempts.push({ id: `a-${st.id}`, studentId: st.id, status: "notattempted" });
      continue;
    }
    attempts.push({ id: done.attemptId, studentId: st.id, status: "finished" });
    attemptSources.set(done.attemptId, { attempted: attemptedByReg.get(done.registration), completed: done.completed });
    const byItem = answers.get(done.registration);
    for (const item of quiz.items) {
      const s = byItem?.get(item.id);
      if (!s) {
        responses.push({ attemptId: done.attemptId, itemId: item.id, rawAnswer: null, gradedState: "unanswered", score: 0 });
        continue;
      }
      const r = s.result;
      if (typeof r?.response !== "string" || typeof r.success !== "boolean") {
        throw new XapiConversionError(`Statement ${s.id}: result.response·success가 없다`);
      }
      const score = r.success ? 1 : 0;
      if (r.score?.raw !== undefined && r.score.raw !== score) throw new XapiConversionError(`Statement ${s.id}: success와 score.raw가 다르다`);
      const gradedState: GradedState = r.success ? "correct" : "incorrect";
      responses.push({ attemptId: done.attemptId, itemId: item.id, rawAnswer: r.response, gradedState, score });
      sources.set(sourceKey(done.attemptId, item.id), s.id);
    }
  }

  for (const sid of completedByStudent.keys()) {
    if (!roster.some((st) => st.id === sid)) throw new XapiConversionError(`명단에 없는 학생 ${sid}의 응시가 있다`);
  }

  return {
    dataset: { dataVersion: def.dataVersion, quiz, students: roster, attempts, responses },
    sources,
    attemptSources,
  };
}
