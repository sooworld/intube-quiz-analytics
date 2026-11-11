// 퀴즈 응답 → xAPI Statement (docs/xapi-profile.md).
// 시간 값은 응답 생성과 다른 난수열로 만든다. 응답 rng 순서를 바꾸면 quiz-w5와 quiz-w5e가 모두 달라지기 때문이다.
import { v5 as uuidv5 } from "uuid";
import type { Attempt, Item, Quiz, Response } from "../../src/lib/types";
import {
  ACTIVITY_TYPE, courseIri, EXT, IRI_BASE, itemIri, PLATFORM, quizIri, STATEMENT_DATA_VERSION,
  USERS_HOMEPAGE, VERB, VERB_DISPLAY, type XActivity, type XStatement,
} from "../../src/lib/xapi/vocab";

const KO = "ko-KR";
const NS = uuidv5(`${IRI_BASE}/statements/${STATEMENT_DATA_VERSION}`, uuidv5.URL);
const KST_MS = 9 * 3600 * 1000;

/** 내용 키에서 만든 결정적 UUID. 같은 데이터 버전에서 다시 생성해도 id가 같다 */
export const statementId = (...parts: string[]) => uuidv5(parts.join("|"), NS);

/** "2026-11-05T14:12:03+09:00" */
export function kst(ms: number): string {
  return new Date(ms + KST_MS).toISOString().slice(0, 19) + "+09:00";
}

export function isoDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

function quizActivity(quiz: Quiz): XActivity {
  return {
    objectType: "Activity",
    id: quizIri(quiz.courseId, quiz.id),
    definition: { name: { [KO]: quiz.name }, description: { [KO]: quiz.intro }, type: ACTIVITY_TYPE.assessment },
  };
}

function itemActivity(quiz: Quiz, item: Item): XActivity {
  const base = { name: { [KO]: `Q${item.number}` }, description: { [KO]: item.stem }, type: ACTIVITY_TYPE.interaction };
  if (item.type === "mcq") {
    return {
      objectType: "Activity",
      id: itemIri(quiz.courseId, quiz.id, item.id),
      definition: {
        ...base,
        interactionType: "choice",
        correctResponsesPattern: [item.correctOptionId!],
        choices: item.options!.map((o) => ({ id: o.id, description: { [KO]: o.text } })),
      },
    };
  }
  // 단답형은 숫자형 정책이어도 학생이 자유 입력("５", "5cm")을 하므로 fill-in으로 둔다.
  // 정오의 정본은 result.success다. 정규화(D3)는 패턴으로 다 표현되지 않아 패턴은 참고용이다.
  const spec = item.shortAnswer!;
  const patterns = spec.policy === "text" ? spec.accepted.map((a) => `{case_matters=false}${a}`) : spec.accepted;
  return {
    objectType: "Activity",
    id: itemIri(quiz.courseId, quiz.id, item.id),
    definition: { ...base, interactionType: "fill-in", correctResponsesPattern: patterns },
  };
}

const verb = (key: keyof typeof VERB) => ({ id: VERB[key], display: { [KO]: VERB_DISPLAY[key] } });
const actor = (studentId: string) => ({ objectType: "Agent" as const, account: { homePage: USERS_HOMEPAGE, name: studentId } });

export interface TimingOptions {
  rand: () => number;
  /** 응시 시작이 들어갈 구간 [from, to] (ms) */
  startFrom: number;
  startTo: number;
}

/**
 * 응시마다 attempted 1건 → 응답한 문항마다 answered 1건(무응답은 없음) → completed 1건.
 * 시간: attempted ≤ answered ≤ completed. 문항 시간은 응답 여부와 상관없이 같은 양의 난수를 쓴다.
 */
export function quizStatements(quiz: Quiz, attempts: Attempt[], responses: Response[], timing: TimingOptions): XStatement[] {
  const out: XStatement[] = [];
  const qAct = quizActivity(quiz);
  const parent = [{ objectType: "Activity" as const, id: qAct.id }];
  const grouping = [{ objectType: "Activity" as const, id: courseIri(quiz.courseId) }];
  const { rand } = timing;

  for (const att of attempts) {
    if (att.status !== "finished") continue;
    const registration = statementId(quiz.id, att.id, "registration");
    const context = { registration, platform: PLATFORM, extensions: { [EXT.attemptId]: att.id } };
    const startMs = timing.startFrom + Math.floor(rand() * ((timing.startTo - timing.startFrom) / 1000)) * 1000;

    out.push({
      id: statementId(quiz.id, att.id, "-", "attempted"),
      actor: actor(att.studentId),
      verb: verb("attempted"),
      object: qAct,
      context: { ...context, contextActivities: { grouping } },
      timestamp: kst(startMs),
    });

    let t = startMs;
    for (const item of quiz.items) {
      const seconds = 20 + Math.floor(rand() * 160);
      const gap = 2 + Math.floor(rand() * 8);
      t += seconds * 1000;
      const r = responses.find((x) => x.attemptId === att.id && x.itemId === item.id);
      if (!r) throw new Error(`응답 없음: ${att.id} ${item.id}`);
      if (r.rawAnswer !== null) {
        out.push({
          id: statementId(quiz.id, att.id, item.id, "answered"),
          actor: actor(att.studentId),
          verb: verb("answered"),
          object: itemActivity(quiz, item),
          result: {
            response: r.rawAnswer,
            success: r.gradedState === "correct",
            score: { raw: r.score, min: 0, max: 1 },
            duration: isoDuration(seconds),
          },
          context: { ...context, contextActivities: { parent, grouping } },
          timestamp: kst(t),
        });
      }
      t += gap * 1000;
    }

    const endMs = t + (5 + Math.floor(rand() * 25)) * 1000;
    out.push({
      id: statementId(quiz.id, att.id, "-", "completed"),
      actor: actor(att.studentId),
      verb: verb("completed"),
      object: qAct,
      result: { completion: true, duration: isoDuration((endMs - startMs) / 1000) },
      context: { ...context, contextActivities: { grouping } },
      timestamp: kst(endMs),
    });
  }
  return out;
}
