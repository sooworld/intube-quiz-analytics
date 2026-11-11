// Google Gemini API (generateContent). 키는 x-goog-api-key 헤더로만 보낸다(URL 쿼리 금지).
import type { GenerateRequest, GenerateResult } from "../task";
import { AiError } from "../types";
import { getJson, parseModelJson, postJson, type FetchLike } from "./http";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini는 잘못된 키에 400(API_KEY_INVALID)을 돌려준다 */
const classify = (status: number, text: string) => (status === 400 && /API_KEY_INVALID|API key not valid/i.test(text) ? "auth" : null);

const SAFETY_FINISH = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE"]);

export function geminiRequestBody(req: Pick<GenerateRequest, "prompt" | "schema" | "maxTokens">) {
  return {
    systemInstruction: { parts: [{ text: req.prompt.system }] },
    contents: [{ role: "user", parts: [{ text: req.prompt.user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: req.schema,
      maxOutputTokens: req.maxTokens,
      temperature: 0,
    },
  };
}

interface GeminiResponse {
  modelVersion?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export async function geminiGenerate(req: GenerateRequest): Promise<GenerateResult> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(req.model)}:generateContent`;
  const json = (await postJson(req.fetchImpl ?? defaultFetch, url, { "x-goog-api-key": req.apiKey }, geminiRequestBody(req), req.signal, req.apiKey, classify)) as GeminiResponse;
  if (json.promptFeedback?.blockReason) throw new AiError("safety", `입력이 차단되었습니다: ${json.promptFeedback.blockReason}`);
  const cand = json.candidates?.[0];
  if (!cand) throw new AiError("format", "응답 후보가 없습니다.");
  const reason = cand.finishReason ?? "STOP";
  if (reason === "MAX_TOKENS") throw new AiError("truncated", "출력이 길이 제한에서 잘렸습니다.");
  if (SAFETY_FINISH.has(reason)) throw new AiError("safety", `출력이 차단되었습니다: ${reason}`);
  if (reason !== "STOP") throw new AiError("format", `예상하지 못한 종료 사유: ${reason}`);
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  return { raw: parseModelJson(text), responseModel: json.modelVersion ?? null };
}

/** 키로 쓸 수 있는 모델 목록 (연결 확인 겸용, 생성 비용 없음). 무료 사용 가능 여부나 스키마 지원은 알려 주지 않는다 */
export async function geminiListModels(opts: { apiKey: string; signal?: AbortSignal; fetchImpl: FetchLike }): Promise<string[]> {
  const json = (await getJson(opts.fetchImpl, `${GEMINI_BASE}/models?pageSize=200`, { "x-goog-api-key": opts.apiKey }, opts.signal, opts.apiKey, classify)) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  return (json.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter((n) => n !== "")
    .sort();
}
