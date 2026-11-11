// AI 채점 제안 계층의 공통 타입 (docs/decisions.md §6, 계획 T3).
// 이 디렉터리의 함수는 브라우저 API에 기대지 않는 순수 함수로 두어 Moodle 플러그인 명세로 옮길 수 있게 한다.
import type { RubricLevel } from "../types";

/** 제공자 목록. 이 순서대로 설정 화면에 나온다. lg는 "기본 AI"(로컬 중계 경유) */
export const PROVIDER_IDS = ["lg", "mock", "gemini", "anthropic", "openai"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(x: unknown): x is ProviderId {
  return (PROVIDER_IDS as readonly unknown[]).includes(x);
}

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  /** OpenAI 호환은 설정의 주소, lg는 호출하는 쪽이 정한 주소(없으면 로컬 중계). 나머지 제공자는 쓰지 않는다 */
  baseUrl?: string;
  /** 키는 이 객체로만 전달하고, 저장·로그·캐시 키·오류 메시지에 넣지 않는다 */
  apiKey?: string;
  /** 기본 AI 중계의 접속 코드(공개 중계만). 키처럼 저장·로그·캐시 키·오류 메시지에 넣지 않는다 */
  relayCode?: string;
}

/** 모델이 돌려준(또는 Mock이 만든) 제안 원본. 검증 전에는 믿지 않는다 */
export interface RawCriterion {
  criterionId: string;
  level: number;
  /** 답안에서 그대로 옮긴 근거 문장. 빈 문자열이면 근거 없음 */
  evidenceQuote: string;
  rationale: string;
}

export interface RawSuggestion {
  criteria: RawCriterion[];
  feedbackDraft: string;
  flags: string[];
}

/** 모델이 달 수 있는 플래그 */
export const MODEL_FLAGS = ["off-topic", "injection-suspected", "insufficient-content"] as const;
export type ModelFlag = (typeof MODEL_FLAGS)[number];
/** 코드가 다는 플래그 */
export type SystemFlag = "empty" | "over-limit";
export type SuggestionFlag = ModelFlag | SystemFlag;

export type SuggestionStatus = "valid" | "needs-review" | "invalid";

/** quote-in-instruction: 답안 속 채점 지시문을 근거로 인용했다 */
export type CriterionIssue = "quote-mismatch" | "no-evidence" | "quote-in-instruction";

export interface ValidatedCriterion {
  criterionId: string;
  level: RubricLevel;
  evidenceQuote: string | null;
  /** 원문에서 근거가 있는 구간 [시작, 끝). 찾지 못하면 null */
  span: [number, number] | null;
  rationale: string;
  issues: CriterionIssue[];
}

export interface ValidatedSuggestion {
  status: SuggestionStatus;
  /** invalid면 비어 있을 수 있다 */
  criteria: ValidatedCriterion[];
  /** 코드가 계산한 총점 */
  total: number;
  feedbackDraft: string;
  flags: SuggestionFlag[];
  /** needs-review·invalid의 이유 (사람이 읽는 문장) */
  problems: string[];
}

export type AiErrorKind =
  | "missing-key"
  | "unsupported"
  | "auth"
  | "not-found"
  | "bad-request"
  | "rate-limit"
  | "server"
  | "network"
  | "timeout"
  | "aborted"
  | "format"
  | "safety"
  | "refusal"
  | "truncated"
  | "relay-auth"
  | "relay-locked"
  | "relay-budget";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.status = status;
  }
}

export const AI_ERROR_TEXT: Record<AiErrorKind, string> = {
  "missing-key": "API 키가 없습니다. AI 설정에서 키를 입력하세요.",
  unsupported: "이 설정으로는 실행할 수 없습니다.",
  auth: "키가 거부되었습니다(인증 실패). 키와 제공자를 확인하세요.",
  "not-found": "모델이나 주소를 찾을 수 없습니다. 모델 id를 확인하세요.",
  "bad-request": "제공자가 요청을 거부했습니다. 모델이 이 요청 형식(JSON 스키마 출력)을 지원하는지 확인하세요.",
  "rate-limit": "사용 한도에 걸렸습니다(429). 잠시 후 다시 시도하세요. 무료 등급 한도는 키가 아니라 프로젝트 단위입니다.",
  server: "제공자 서버 오류입니다. 잠시 후 다시 시도하세요.",
  network: "네트워크 오류이거나 브라우저가 요청을 막았습니다(CORS 등).",
  timeout: "AI가 제한 시간 안에 답하지 못했습니다. 일시적인 지연일 때가 많습니다.",
  aborted: "취소했습니다.",
  format: "응답이 약속한 JSON 형식이 아닙니다.",
  safety: "제공자의 안전 필터가 응답을 막았습니다.",
  refusal: "모델이 응답을 거절했습니다.",
  truncated: "출력이 길이 제한에서 잘렸습니다.",
  "relay-auth": "접속 코드가 없거나 틀렸습니다. AI 설정에서 접속 코드를 확인하세요.",
  "relay-locked": "인증 실패가 많아 중계가 잠시 막혔습니다. 1분쯤 뒤에 다시 시도하세요.",
  "relay-budget": "오늘 시연 예산을 다 썼습니다. 내일 다시 쓰거나 중계의 AI_RELAY_BUDGET을 확인하세요.",
};

/** 같은 요청을 다시 보내면 될 수 있는 오류. 키·설정·형식 지원 문제는 다시 눌러도 같으므로 뺀다 */
const RETRYABLE: AiErrorKind[] = ["timeout", "server", "network", "rate-limit", "format", "truncated"];

export function isRetryable(e: unknown): boolean {
  return e instanceof AiError && RETRYABLE.includes(e.kind);
}

/** 저장되는 제안 한 건. 만든 뒤에는 고치지 않는다(불변) */
export interface StoredSuggestion {
  suggestionId: string;
  provider: ProviderId;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  validatorVersion: string;
  inputHash: string;
  createdAt: string;
  result: ValidatedSuggestion;
}

/** 화면에 보일 오류 문장 (키는 들어 있지 않다) */
export function aiErrorText(e: unknown): string {
  if (!(e instanceof AiError)) return AI_ERROR_TEXT.network;
  // 실행 전 차단(unsupported)은 이유 문장이 더 구체적이다
  if (e.kind === "unsupported" && e.message) return e.message;
  return `${AI_ERROR_TEXT[e.kind]}${e.status ? ` (HTTP ${e.status})` : ""}`;
}
