// Mock 제공자: 규칙 기반 모의 채점(AI 아님). 같은 입력에는 항상 같은 결과를 낸다.
import type { EssayItem } from "../../types";
import type { RawSuggestion } from "../types";
import { INJECTION_PATTERN } from "../injection";
import { MOCK_RULES } from "./mockRules";

/** 문항별 주제 핵심어 */
const TOPIC_WORDS: Record<string, RegExp> = {
  e1: /(시간복잡도|복잡도|big-?o|o\(|루프|해시|set|정렬|중복)/i,
  e2: /(다익스트라|dijkstra|bfs|최단|경로|그래프|우선순위|가중치|정점|간선)/i,
};

/** 문장 단위로 나눈다. 근거 인용은 답안의 한 문장을 그대로 쓴다 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function mockSuggest(item: EssayItem, essay: string): RawSuggestion {
  const sentences = splitSentences(essay);
  const injection = INJECTION_PATTERN.test(essay);
  // 지시문 문장은 채점 근거에서 뺀다
  const usable = sentences.filter((s) => !INJECTION_PATTERN.test(s));
  const body = usable.join(" ");

  const criteria = item.rubric.map((c) => {
    const rule = MOCK_RULES[c.id];
    const j = rule ? rule(body) : { level: 0 as const, evidence: null };
    const quote = j.evidence ? (usable.find((s) => j.evidence!.test(s)) ?? "") : "";
    const desc = c.levels.find((l) => l.level === j.level)!;
    return {
      criterionId: c.id,
      level: j.level,
      evidenceQuote: quote,
      rationale: `규칙 기반 판정: ${desc.label} — ${desc.descriptor}`,
    };
  });

  const flags: string[] = [];
  if (injection) flags.push("injection-suspected");
  // 주제 이탈은 "점수가 0"이 아니라 "문항의 핵심어가 하나도 없음"으로 판단한다(틀린 답과 구분)
  const onTopic = (TOPIC_WORDS[item.id] ?? /./).test(body);
  if (!onTopic && body.length >= 40) flags.push("off-topic");
  else if (body.length < 40) flags.push("insufficient-content");

  const weak = item.rubric.filter((c) => criteria.find((x) => x.criterionId === c.id)!.level < 2).map((c) => c.name);
  const strong = item.rubric.filter((c) => criteria.find((x) => x.criterionId === c.id)!.level === 2).map((c) => c.name);
  const feedbackDraft = [
    strong.length ? `${strong.join(", ")}에 대한 설명은 루브릭 기준을 충족합니다.` : "답안에서 루브릭 기준을 충족한 부분을 찾지 못했습니다.",
    weak.length ? `${weak.join(", ")} 부분을 근거와 함께 보완해 보세요.` : "근거와 결론이 잘 연결되어 있습니다.",
    "(규칙 기반 모의 채점 초안입니다.)",
  ].join(" ");

  return { criteria, feedbackDraft, flags };
}
