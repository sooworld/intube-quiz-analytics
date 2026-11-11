// fetch 기반 제공자(Gemini, OpenAI 호환)의 공통 처리: 상태 코드 분류, 키 가리기, JSON 파싱.
import { AiError, type AiErrorKind } from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 오류 메시지에 키가 섞여 나오지 않게 가린다 */
export function redact(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey && apiKey.length >= 4) {
    // 오류 본문은 JSON이나 URL 인코딩을 거쳐 올 수 있으므로 변형된 형태도 가린다
    const forms = new Set([apiKey, JSON.stringify(apiKey).slice(1, -1), encodeURIComponent(apiKey)]);
    for (const form of forms) out = out.split(form).join("[키 가림]");
  }
  return out.replace(/(key=)[^&\s"]+/gi, "$1[키 가림]").slice(0, 300);
}

export function kindForStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limit";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "bad-request";
}

/** fetch 자체가 실패한 경우(네트워크·CORS·취소) */
export function fromFetchFailure(err: unknown, signal?: AbortSignal): AiError {
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason instanceof AiError) return reason;
    return new AiError("aborted", "취소했습니다.");
  }
  if (err instanceof AiError) return err;
  return new AiError("network", "네트워크 오류이거나 브라우저가 요청을 막았습니다(CORS 등).");
}

export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
  apiKey: string | undefined,
  classify?: (status: number, text: string) => AiErrorKind | null,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  } catch (err) {
    throw fromFetchFailure(err, signal);
  }
  return readJson(res, apiKey, classify, signal);
}

export async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, signal: AbortSignal | undefined, apiKey: string | undefined, classify?: (status: number, text: string) => AiErrorKind | null): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers, signal });
  } catch (err) {
    throw fromFetchFailure(err, signal);
  }
  return readJson(res, apiKey, classify, signal);
}

async function readJson(res: Response, apiKey: string | undefined, classify: ((status: number, text: string) => AiErrorKind | null) | undefined, signal?: AbortSignal): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw fromFetchFailure(err, signal);
  }
  if (!res.ok) {
    const kind = classify?.(res.status, text) ?? kindForStatus(res.status);
    throw new AiError(kind, `HTTP ${res.status}: ${redact(text, apiKey)}`, res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("format", "제공자 응답이 JSON이 아닙니다.");
  }
}

/** 모델이 낸 텍스트에서 JSON 객체를 읽는다. 코드 울타리(```json)는 걷어 낸다 */
export function parseModelJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (t === "") throw new AiError("format", "모델 응답이 비어 있습니다.");
  try {
    return JSON.parse(t);
  } catch {
    throw new AiError("format", "모델 응답이 JSON 형식이 아닙니다.");
  }
}
