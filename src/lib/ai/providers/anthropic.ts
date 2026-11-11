// Anthropic Claude (Messages API, 공식 SDK).
// 브라우저에서 바로 부르려면 dangerouslyAllowBrowser가 필요하다. 이 옵션은 보안 장치가 아니다:
// 키가 이 페이지의 스크립트와 제공자에게 그대로 노출된다. 그래서 "현재 브라우저 개인 키 시연"으로만 쓴다.
// 실제 교수별 키 관리는 서버(Moodle) 쪽 설계를 따른다(docs/moodle-ai-integration.md).
import Anthropic from "@anthropic-ai/sdk";
import type { GenerateRequest, GenerateResult } from "../task";
import { AiError } from "../types";
import { parseModelJson, redact, type FetchLike } from "./http";

/** 기본 모델. 설정 화면에서 바꿀 수 있다 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** 서버 측 거절 대체(fallbacks: "default")를 받는 모델 */
const FALLBACK_CAPABLE = /^claude-(opus-5|fable-5|mythos-5|sonnet-5-5)/;

function client(apiKey: string, fetchImpl?: FetchLike) {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 0, // 재시도는 client.ts가 정한다(형식 오류만 1회)
    ...(fetchImpl ? { fetch: fetchImpl as typeof fetch } : {}),
  });
}

/** SDK 오류를 공통 오류 종류로 바꾼다. 메시지에서 키를 가린다 */
export function fromAnthropicError(err: unknown, apiKey: string, signal?: AbortSignal): AiError {
  if (err instanceof AiError) return err;
  if (signal?.aborted) {
    return signal.reason instanceof AiError ? signal.reason : new AiError("aborted", "취소했습니다.");
  }
  const msg = (e: Error) => redact(e.message, apiKey);
  if (err instanceof Anthropic.APIUserAbortError) return new AiError("aborted", "취소했습니다.");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", "응답 시간이 초과되었습니다.");
  if (err instanceof Anthropic.APIConnectionError) return new AiError("network", "네트워크 오류이거나 브라우저가 요청을 막았습니다(CORS 등).");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiError("auth", msg(err), err.status);
  if (err instanceof Anthropic.NotFoundError) return new AiError("not-found", msg(err), 404);
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate-limit", msg(err), 429);
  if (err instanceof Anthropic.BadRequestError) return new AiError("bad-request", msg(err), 400);
  if (err instanceof Anthropic.APIError) return new AiError(err.status && err.status < 500 ? "bad-request" : "server", msg(err), err.status);
  return new AiError("network", "알 수 없는 오류가 났습니다.");
}

export async function anthropicGenerate(req: GenerateRequest): Promise<GenerateResult> {
  const fallback = FALLBACK_CAPABLE.test(req.model);
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client(req.apiKey, req.fetchImpl).beta.messages.create(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.prompt.system,
        messages: [{ role: "user", content: req.prompt.user }],
        output_config: { format: { type: "json_schema", schema: req.schema } },
        // 안전 분류기가 거절하면 서버가 권장 모델로 다시 실행한다
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: req.signal },
    );
  } catch (err) {
    throw fromAnthropicError(err, req.apiKey, req.signal);
  }
  if (res.stop_reason === "refusal") throw new AiError("refusal", "모델이 응답을 거절했습니다.");
  if (res.stop_reason === "max_tokens") throw new AiError("truncated", "출력이 길이 제한에서 잘렸습니다.");
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  // 서버 측 거절 대체가 일어나면 res.model이 요청 모델과 다를 수 있다
  return { raw: parseModelJson(text), responseModel: res.model ?? null };
}

export async function anthropicListModels(opts: { apiKey: string; signal?: AbortSignal; fetchImpl?: FetchLike }): Promise<string[]> {
  try {
    const page = await client(opts.apiKey, opts.fetchImpl).models.list({ limit: 100 }, { signal: opts.signal });
    return page.data.map((m) => m.id).sort();
  } catch (err) {
    throw fromAnthropicError(err, opts.apiKey, opts.signal);
  }
}
