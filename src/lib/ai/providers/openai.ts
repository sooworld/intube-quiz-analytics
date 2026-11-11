// OpenAI Chat Completions와 그 형식을 따르는 엔드포인트.
// 지원 범위: OpenAI 본가, 그리고 response_format json_schema(strict)를 지원하고 브라우저 CORS를 허용하는 엔드포인트.
// "OpenAI 호환"이라고 해서 모두 되는 것은 아니다(capabilities.ts 참고).
import type { GenerateRequest, GenerateResult } from "../task";
import { AiError } from "../types";
import { getJson, parseModelJson, postJson, type FetchLike } from "./http";

export const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";

export function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl?.trim() || OPENAI_DEFAULT_BASE).replace(/\/+$/, "");
}

export function openaiRequestBody(req: Pick<GenerateRequest, "prompt" | "schema" | "schemaName" | "maxTokens" | "model">, baseUrl: string) {
  const p = req.prompt;
  const isOpenAI = /^https:\/\/api\.openai\.com\//.test(baseUrl + "/");
  return {
    model: req.model,
    messages: [
      { role: "system", content: p.system },
      { role: "user", content: p.user },
    ],
    response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
    // OpenAI 본가는 max_completion_tokens, 호환 서버는 대개 max_tokens를 받는다
    ...(isOpenAI ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
  };
}

interface ChatResponse {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  /** 기본 AI(lg)는 reasoning_tokens를 usage 바로 아래에, OpenAI는 completion_tokens_details 아래에 둔다 */
  usage?: { completion_tokens?: number; reasoning_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } | null };
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Chat Completions 응답을 해석한다(OpenAI 호환·LG 공용). 추론 텍스트(reasoning_content)는 쓰지 않는다 */
export function readChatCompletion(body: unknown): GenerateResult {
  const json = body as ChatResponse;
  const choice = json.choices?.[0];
  if (!choice) throw new AiError("format", "응답 후보가 없습니다.");
  if (choice.message?.refusal) throw new AiError("refusal", "모델이 응답을 거절했습니다.");
  if (choice.finish_reason === "length") throw new AiError("truncated", "출력이 길이 제한에서 잘렸습니다.");
  if (choice.finish_reason === "content_filter") throw new AiError("safety", "출력이 콘텐츠 필터에 막혔습니다.");
  const u = json.usage;
  const usage = u ? { completionTokens: num(u.completion_tokens), reasoningTokens: num(u.reasoning_tokens) ?? num(u.completion_tokens_details?.reasoning_tokens) } : null;
  return { raw: parseModelJson(choice.message?.content ?? ""), responseModel: json.model ?? null, usage };
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export async function openaiGenerate(req: GenerateRequest): Promise<GenerateResult> {
  const base = normalizeBaseUrl(req.baseUrl);
  const json = await postJson(req.fetchImpl ?? defaultFetch, `${base}/chat/completions`, { authorization: `Bearer ${req.apiKey}` }, openaiRequestBody(req, base), req.signal, req.apiKey);
  return readChatCompletion(json);
}

export async function openaiListModels(opts: { apiKey: string; baseUrl?: string; signal?: AbortSignal; fetchImpl: FetchLike }): Promise<string[]> {
  const json = (await getJson(opts.fetchImpl, `${normalizeBaseUrl(opts.baseUrl)}/models`, { authorization: `Bearer ${opts.apiKey}` }, opts.signal, opts.apiKey)) as { data?: { id?: string }[] };
  return (json.data ?? []).map((m) => m.id ?? "").filter((id) => id !== "").sort();
}
