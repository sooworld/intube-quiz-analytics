// 제공자 능력표 (계획 T3). "계약 테스트"는 모의 fetch로 요청·응답 형태만 검사했다는 뜻이고,
// "실연 확인"은 실제 브라우저에서 키로 호출해 본 결과다. 둘을 섞지 않는다.
import { ANTHROPIC_DEFAULT_MODEL } from "./providers/anthropic";
import { LG_MODEL, LG_RELAY_BASE, relayBase } from "./providers/lg";
import { OPENAI_DEFAULT_BASE } from "./providers/openai";
import { AiError, isProviderId, type AiErrorKind, type ProviderConfig, type ProviderId } from "./types";

export type Verification = "계약 테스트만" | "실연 확인" | "실연 실패";

export interface ProviderCapability {
  id: ProviderId;
  label: string;
  needsKey: boolean;
  defaultModel: string;
  /** 브라우저에서 직접 부를 수 있는지 (제공자 문서 기준) */
  browserDirect: string;
  structuredOutput: string;
  auth: string;
  verification: Verification;
  notes: string[];
}

export const CAPABILITIES: Record<ProviderId, ProviderCapability> = {
  lg: {
    id: "lg",
    label: "AI",
    needsKey: false,
    defaultModel: LG_MODEL,
    browserDirect: "불가. 제공자 서버가 브라우저 CORS를 허용하지 않아(사전 요청에 401) 중계(npm run ai:proxy)를 거칩니다. 키는 중계가 .env·Secret의 LG_API_KEY에서 읽습니다",
    structuredOutput: "response_format: json_schema (strict)",
    auth: "중계가 Authorization: Bearer를 붙임 (브라우저에는 키가 없고, 공개 중계는 접속 코드를 씀)",
    // 2026-11-11: 서술형 채점 제안을 실연 스크립트(직접)와 브라우저(로컬 중계) 양쪽에서 확인(README 실연 기록)
    verification: "실연 확인",
    notes: [
      "로컬 실행(npm run dev + npm run ai:proxy)이나, 설정에 입력한 시연용 공개 중계(https 주소와 접속 코드)에서 씁니다. 중계 없이 공개 사이트에서는 쓸 수 없습니다.",
      "한도: 하루 100건, 분당 60건, 초당 1건(2026-11-11 응답 헤더 기준). 형식 오류면 1회 더 부르므로 답안 1건은 1–2건입니다.",
      "추론이 항상 켜져 있어 추론 강도를 low로 보냅니다.",
    ],
  },
  mock: {
    id: "mock",
    label: "Mock (규칙 기반 모의 채점, AI 아님)",
    needsKey: false,
    defaultModel: "rules-v1",
    browserDirect: "네트워크를 쓰지 않음",
    structuredOutput: "코드가 직접 만듦",
    auth: "없음",
    verification: "실연 확인",
    notes: ["핵심어 규칙으로만 판단합니다. 키 없이 흐름을 시연하고 테스트하기 위한 것입니다."],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    // 무료 등급 모델 id는 바뀔 수 있다. 설정 화면의 "모델 목록 불러오기"로 확인한다
    defaultModel: "gemini-3.5-flash-lite",
    browserDirect: "Gemini API는 브라우저 호출을 허용하지만, Google은 운영 환경에서 클라이언트에 키를 두지 말라고 안내합니다",
    structuredOutput: "responseMimeType: application/json + responseJsonSchema",
    auth: "x-goog-api-key 헤더",
    verification: "계약 테스트만",
    notes: [
      "무료 등급 한도(분당·일일 요청 수)는 키가 아니라 Google 프로젝트 단위입니다.",
      "무료 등급에서는 입력과 출력이 Google의 제품 개선과 사람 검토에 쓰일 수 있습니다. 가상 답안만 보내세요.",
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    needsKey: true,
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    browserDirect: "공식 SDK의 dangerouslyAllowBrowser 옵션으로 가능. 보안 장치가 아니라 위험을 감수한다는 표시입니다",
    structuredOutput: "output_config.format (json_schema)",
    auth: "Authorization: Bearer (공식 SDK 1.x)",
    verification: "계약 테스트만",
    notes: ["거절 대체(fallbacks: \"default\")를 지원하는 모델에서는 자동으로 켭니다."],
  },
  openai: {
    id: "openai",
    label: "OpenAI 호환",
    needsKey: true,
    defaultModel: "",
    browserDirect: "엔드포인트마다 다릅니다(CORS 허용 여부 확인 필요)",
    structuredOutput: "response_format: json_schema (strict)",
    auth: "Authorization: Bearer",
    verification: "계약 테스트만",
    notes: [
      `기본 주소는 ${OPENAI_DEFAULT_BASE}입니다. json_schema 출력과 브라우저 CORS를 지원하는 엔드포인트만 동작합니다.`,
      "Ollama 같은 로컬 서버는 https로 배포된 페이지에서 http 주소로 부를 수 없습니다. localhost 개발 서버에서만 시도하세요(OLLAMA_ORIGINS 설정 필요).",
    ],
  },
};

/** 화면에 보일 모델 이름. 기본 AI(lg)는 실제 id 대신 "AI"로 보인다(기록에는 실제 id가 남는다) */
export function modelLabel(provider: string, model: string): string {
  return provider === "lg" ? "AI" : model;
}

/** 저장 기록의 제공자 문자열을 화면 이름으로 (알 수 없는 값은 그대로) */
export function providerLabel(provider: string): string {
  return isProviderId(provider) ? CAPABILITIES[provider].label : provider;
}

/** 오류 문장에 붙일 제공자별 안내. 기본 AI의 네트워크 오류는 대개 로컬 중계가 꺼진 경우다 */
export function errorHint(provider: ProviderId, e: unknown): string {
  return provider === "lg" && e instanceof AiError && e.kind === "network" ? " AI 중계(npm run ai:proxy)가 켜져 있는지, AI 설정의 중계 주소가 맞는지 확인하세요." : "";
}

/** 화면에 보일 짧은 제공자 이름 (제안 이력 등) */
export function providerShortLabel(provider: ProviderId): string {
  return CAPABILITIES[provider].label.split(" ")[0]!;
}

/** "제공자 · 모델" 표시. 기본 AI는 제공자 이름과 모델 이름이 같은 "AI"라 하나만 보인다. short면 제공자 이름을 짧게 */
export function providerModelLabel(provider: string, model: string, short = false): string {
  const name = short && isProviderId(provider) ? providerShortLabel(provider) : providerLabel(provider);
  const shown = modelLabel(provider, model);
  return shown === name ? name : `${name} · ${shown}`;
}

/**
 * 실행 전에 막아야 할 설정이면 종류와 이유를, 아니면 null을 돌려준다.
 * pageProtocol은 테스트를 위해 주입한다(브라우저에서는 location.protocol).
 * 모델 목록 조회(연결 확인)도 키를 보내므로 같은 규칙을 거친다. 이때는 모델 id만 검사하지 않는다.
 */
export function blockReason(config: ProviderConfig, pageProtocol = "https:", purpose: "grade" | "list-models" = "grade"): { kind: AiErrorKind; message: string } | null {
  const cap = CAPABILITIES[config.provider];
  if (cap.needsKey && !config.apiKey?.trim()) return { kind: "missing-key", message: "API 키가 없습니다. AI 설정에서 키를 입력하세요." };
  const no = (message: string) => ({ kind: "unsupported" as const, message });
  if (purpose === "grade" && config.provider !== "mock" && !config.model.trim()) return no("모델 id가 없습니다. AI 설정에서 모델을 고르세요.");
  if (config.provider === "lg") {
    const url = relayBase(config.baseUrl);
    if (url === null) return no("중계 주소 형식이 올바르지 않습니다. https://… 형태의 주소(경로 없이)를 넣으세요.");
    // http 중계(로컬)는 https 페이지에서 부를 수 없다. 실연 스크립트의 직접 주소(https)는 막지 않는다
    if (pageProtocol === "https:" && url.startsWith("http:")) {
      return no(
        url === LG_RELAY_BASE
          ? "이 사이트에서 AI를 쓰려면 AI 설정에서 시연용 중계 주소(https)와 접속 코드를 입력하세요. 중계가 없으면 Mock이나 다른 제공자를 고르세요."
          : "이 사이트(https)에서는 http 중계 주소를 부를 수 없습니다. https 중계 주소를 입력하세요.",
      );
    }
  }
  if (config.provider === "openai") {
    const base = config.baseUrl?.trim() || OPENAI_DEFAULT_BASE;
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      return no("주소(base URL) 형식이 올바르지 않습니다.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return no("주소는 http(s)여야 합니다.");
    if (pageProtocol === "https:" && url.protocol === "http:") return no("https 페이지에서는 http 주소를 부를 수 없습니다(혼합 콘텐츠 차단). localhost 개발 서버에서 시도하세요.");
    if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return no("http 주소는 localhost만 허용합니다. 키가 암호화되지 않은 채 전송됩니다.");
  }
  return null;
}
