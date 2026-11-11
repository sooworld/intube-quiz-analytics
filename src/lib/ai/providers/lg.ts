// 기본 AI (OpenAI 호환 Chat Completions).
// 제공자 서버는 브라우저 CORS를 허용하지 않는다(2026-11-11 측정: 사전 요청에 401, 허용 헤더 없음).
// 그래서 브라우저는 로컬 중계(scripts/ai-proxy.ts)를 키 없이 부르고, 중계가 .env의 LG_API_KEY를 붙인다.
// Node 실연 스크립트는 직접 주소와 키를 넘겨 바로 부른다.
import type { GenerateRequest, GenerateResult } from "../task";
import { AiError, type AiErrorKind } from "../types";
import { getJson, postJson, type FetchLike } from "./http";
import { openaiRequestBody, readChatCompletion } from "./openai";

export const LG_RELAY_BASE = "http://127.0.0.1:8787/v1";
export const LG_DIRECT_BASE = "https://api.exaone.ai/v1";
export const LG_MODEL = "k-exaone_v2.5";
/** 중계가 모든 응답에 붙이는 식별 헤더. 8787 포트의 다른 서비스와 구분한다 */
export const RELAY_HEADER = "x-learnlens-relay";
/** 공개 중계의 접속 코드와 실행 ID를 싣는 요청 헤더 (중계: scripts/relay/policy.ts) */
export const RELAY_CODE_HEADER = "x-relay-code";
export const RELAY_RUN_HEADER = "x-relay-run";

/** 추론은 항상 켜져 있고 추론 토큰도 max_tokens에 들어간다. 기본값(max)은 느리고 잘리기 쉬워 low로 둔다 */
export const LG_REASONING_EFFORT = "low";
/**
 * 추론 토큰이 많아 느리다(2026-11-11 실연, 초당 약 26토큰): 서술형 채점 58초, 태그 초안 125초, 요약 초안 126초.
 * 150초에서는 이 작업들이 한도에 거의 닿아 시간 초과가 났다. 가장 긴 관계 초안도 넘지 않게 5분으로 둔다.
 */
export const LG_TIMEOUT_MS = 300_000;

/**
 * 중계 주소를 "출처/v1" 형태로 맞춘다. 비어 있으면 로컬 중계. 끝의 "/"와 "/v1"은 붙여 넣은 값에 있어도 한 번만 남긴다.
 * 주소 형식이 틀리면 null.
 */
export function relayBase(input: string | undefined): string | null {
  const t = input?.trim();
  if (!t) return LG_RELAY_BASE;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  if (path !== "") return null; // 출처만 받는다
  return `${url.origin}/v1`;
}

const base = (baseUrl: string | undefined) => relayBase(baseUrl) ?? LG_RELAY_BASE;
/** 키가 있을 때(직접 호출)만 인증 헤더를 붙인다. 중계 호출에는 키가 없다 */
const authHeaders = (apiKey: string | undefined): Record<string, string> => (apiKey ? { authorization: `Bearer ${apiKey}` } : {});
/** 중계에는 접속 코드와 실행 ID를 싣는다. 직접 호출(키)과 함께 쓰지 않는다 */
const relayHeaders = (relayCode: string | undefined, runId: string | undefined): Record<string, string> => ({
  ...(relayCode ? { [RELAY_CODE_HEADER]: relayCode } : {}),
  ...(runId ? { [RELAY_RUN_HEADER]: runId } : {}),
});

/** 중계 자체의 오류(접속 코드·잠금·예산)는 응답 본문의 error.code로 구분한다. 업스트림의 401 등은 기존 규칙을 따른다 */
const classify = (_status: number, text: string): AiErrorKind | null => {
  let code: unknown;
  try {
    code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
  } catch {
    return null;
  }
  if (code === "relay_auth") return "relay-auth";
  if (code === "relay_locked") return "relay-locked";
  if (code === "relay_budget") return "relay-budget";
  if (code === "relay_storage") return "server";
  return null;
};

export function lgRequestBody(req: Pick<GenerateRequest, "prompt" | "schema" | "schemaName" | "maxTokens" | "model">) {
  // 비OpenAI 주소이므로 openaiRequestBody는 max_tokens를 쓴다
  return { ...openaiRequestBody(req, LG_DIRECT_BASE), temperature: 0, reasoning_effort: LG_REASONING_EFFORT };
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export async function lgGenerate(req: GenerateRequest): Promise<GenerateResult> {
  const headers = { ...authHeaders(req.apiKey), ...relayHeaders(req.relayCode, req.runId) };
  const json = await postJson(req.fetchImpl ?? defaultFetch, `${base(req.baseUrl)}/chat/completions`, headers, lgRequestBody(req), req.signal, req.apiKey, classify);
  return readChatCompletion(json);
}

/**
 * 모델 목록(연결 확인 겸용, 생성 비용 없음). 중계를 거칠 때는 식별 헤더가 없으면 다른 서비스로 보고 실패시킨다.
 * getJson은 헤더를 돌려주지 않으므로 여기서 fetch를 감싸 헤더를 본다.
 */
export async function lgListModels(opts: { baseUrl?: string; apiKey?: string; relayCode?: string; signal?: AbortSignal; fetchImpl: FetchLike }): Promise<string[]> {
  const url = base(opts.baseUrl);
  const viaRelay = url !== LG_DIRECT_BASE;
  let relaySeen = false;
  const fetchImpl: FetchLike = async (input, init) => {
    const res = await opts.fetchImpl(input, init);
    relaySeen = res.headers.get(RELAY_HEADER) === "1";
    return res;
  };
  const json = (await getJson(fetchImpl, `${url}/models`, { ...authHeaders(opts.apiKey), ...relayHeaders(opts.relayCode, undefined) }, opts.signal, opts.apiKey, classify)) as { data?: { id?: string }[] };
  if (viaRelay && !relaySeen) throw new AiError("unsupported", "이 주소의 응답이 LearnLens 중계가 아닙니다. 중계 주소와 npm run ai:proxy 실행 여부를 확인하세요.");
  return (json.data ?? []).map((m) => m.id ?? "").filter((id) => id !== "").sort();
}
