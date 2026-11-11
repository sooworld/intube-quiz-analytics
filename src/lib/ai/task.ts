// AI 작업 공통 계약 (docs/decisions.md §6, §8). 작업마다 프롬프트·출력 스키마·검증기·Mock을 묶는다.
// 제공자는 작업 내용을 모르고 { system, user, schema }만 전달한다.
import type { FetchLike } from "./providers/http";

export type AiTaskId = "essay-grade" | "tag-draft" | "relation-draft" | "analysis-summary";

export const AI_TASK_IDS: AiTaskId[] = ["essay-grade", "tag-draft", "relation-draft", "analysis-summary"];

export const AI_TASK_LABEL: Record<AiTaskId, string> = {
  "essay-grade": "서술형 채점 제안",
  "tag-draft": "개념 태그 초안",
  "relation-draft": "개념 관계 초안",
  "analysis-summary": "결과 분석 요약 초안",
};

export interface PromptPair {
  system: string;
  user: string;
}

export interface AiTask<I, V> {
  id: AiTaskId;
  /** 프롬프트·스키마·검증 규칙을 바꾸면 올린다(저장된 초안의 출처 구분) */
  promptVersion: string;
  schemaVersion: string;
  validatorVersion: string;
  /** OpenAI json_schema name */
  schemaName: string;
  maxTokens: number;
  buildPrompt(input: I): PromptPair;
  /** 모든 속성 필수, additionalProperties false, 조건 분기(if/then/oneOf) 없음 */
  schema(input: I): Record<string, unknown>;
  /** 모델 출력은 믿지 않는다. 구조 오류는 invalid, 근거 문제는 needs-review */
  validate(raw: unknown, input: I): V;
  /** 키 없는 규칙 기반 출력(AI 아님). 같은 입력에는 같은 결과 */
  mock(input: I): unknown;
}

/** 제공자 공통 요청 */
export interface GenerateRequest {
  prompt: PromptPair;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  model: string;
  apiKey: string;
  baseUrl?: string;
  /** 기본 AI 중계의 접속 코드 */
  relayCode?: string;
  /** 실행 한 번을 가리키는 ID. 중계가 이 ID로 호출 수를 센다(재시도는 같은 ID) */
  runId?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}

/** 토큰 사용량 (실연 기록용. 앱 저장소에는 넣지 않는다) */
export interface TokenUsage {
  completionTokens: number | null;
  /** 추론 토큰. max_tokens 안에서 함께 센다(기본 AI) */
  reasoningTokens: number | null;
}

export interface GenerateResult {
  raw: unknown;
  /** 제공자가 응답에 적은 실제 모델. 알 수 없으면 null */
  responseModel: string | null;
  usage?: TokenUsage | null;
}

/** Mock 제공자가 기록하는 모델 이름 */
export const MOCK_MODEL = "rules-v1";

/**
 * 신뢰할 수 없는 텍스트를 <tag>…</tag> 구분자 안에 넣을 때, 안에 든 같은 이름의 태그를 무력화한다.
 * 다른 꺾쇠(예: "p < 0.05")는 건드리지 않아 원문 인용 대조가 깨지지 않는다.
 */
export function fenceSafe(text: string, tags: string[]): string {
  if (tags.length === 0) return text;
  const re = new RegExp(String.raw`<\/?(?:${tags.join("|")})\b[^>]*>`, "gi");
  return text.replace(re, (m) => m.replace("<", "‹").replace(">", "›"));
}
