// 기본 AI와 로컬 중계 테스트. 실제 네트워크는 쓰지 않고 fetch를 주입한다.
import { describe, expect, it, vi } from "vitest";
import w5e from "@/data/quiz-w5e.json";
import { blockReason, modelLabel, providerLabel, providerModelLabel, providerShortLabel } from "@/lib/ai/capabilities";
import { requestSuggestion, runTask } from "@/lib/ai/client";
import { createAiSettingsStore, defaultProviderFor, SETTINGS_KEY, type StorageLike } from "@/lib/ai/keyStore";
import { LG_DIRECT_BASE, LG_MODEL, LG_RELAY_BASE, lgListModels, lgRequestBody } from "@/lib/ai/providers/lg";
import { readChatCompletion } from "@/lib/ai/providers/openai";
import { essayGradeTask } from "@/lib/ai/tasks/essayGrade";
import { AiError, type ProviderConfig } from "@/lib/ai/types";
import { isAiDraft } from "@/lib/state/aiRecords";
import type { EssayQuizDataset } from "@/lib/types";

const ds = w5e as unknown as EssayQuizDataset;
const E1 = ds.quiz.items.find((i) => i.id === "e1")!;
const KEY = "sk-test-SECRET-1234567890";
const ESSAY = "중첩 루프라 O(n²)이다. 해시 집합으로 한 번만 순회하면 된다.\n 단점은 추가 메모리가 필요하다는 것이다.";
const GOOD = {
  criteria: [
    { criterionId: "e1-fix", level: 2, evidenceQuote: "해시 집합으로 한 번만 순회하면 된다.", rationale: "이유를 들었다." },
    { criterionId: "e1-bigo", level: 2, evidenceQuote: "중첩 루프라 O(n²)이다.", rationale: "정의가 맞다." },
    { criterionId: "e1-tradeoff", level: 1, evidenceQuote: "추가 메모리가 필요하다", rationale: "하나만 구체적이다." },
  ],
  feedbackDraft: "잘 썼습니다.",
  flags: [],
};

function chat(content: string, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const body = {
    model: LG_MODEL,
    object: "chat.completion",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, reasoning_content: "생각 중… {\"x\": 1}" } }],
    usage: { completion_tokens: 120, prompt_tokens: 800, total_tokens: 920, reasoning_tokens: 60, completion_tokens_details: null },
    ...over,
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

const relayConfig: ProviderConfig = { provider: "lg", model: LG_MODEL };

describe("기본 AI 어댑터 (lg)", () => {
  it("브라우저는 키 없이 로컬 중계로 보낸다. 본문에 추론 강도 low, temperature 0, max_tokens, JSON 스키마가 있다", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => chat(`\n\n${JSON.stringify(GOOD)}`));
    const s = await requestSuggestion({ config: relayConfig, item: E1, essay: ESSAY, fetchImpl, pageProtocol: "http:" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${LG_RELAY_BASE}/chat/completions`);
    expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: LG_MODEL, temperature: 0, reasoning_effort: "low", max_tokens: essayGradeTask.maxTokens });
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    // 응답 앞의 줄바꿈과 추론 텍스트(reasoning_content)는 결과에 영향을 주지 않는다
    expect(s.result.status).toBe("valid");
    expect(s.provider).toBe("lg");
    expect(s.model).toBe(LG_MODEL); // 기록에는 실제 id
  });

  it("실연 스크립트는 직접 주소와 Bearer 키로 보낸다. 사용량을 돌려준다", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => chat(JSON.stringify(GOOD)));
    const run = await runTask(essayGradeTask, { item: E1, essay: ESSAY }, { config: { ...relayConfig, baseUrl: LG_DIRECT_BASE, apiKey: KEY }, fetchImpl, retryFormat: false });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.exaone.ai/v1/chat/completions");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(run.usage).toEqual({ completionTokens: 120, reasoningTokens: 60 });
    expect(run.responseModel).toBe(LG_MODEL);
  });

  it("잘림·형식 오류·인증 실패를 구분한다. 오류 문장에 키가 섞이지 않는다", async () => {
    const truncated = vi.fn(async () => chat("{", { choices: [{ finish_reason: "length", message: { content: "{" } }] }));
    await expect(runTask(essayGradeTask, { item: E1, essay: ESSAY }, { config: relayConfig, fetchImpl: truncated, pageProtocol: "http:" })).rejects.toMatchObject({ kind: "truncated" });

    const notJson = vi.fn(async () => chat("채점 결과입니다"));
    await expect(runTask(essayGradeTask, { item: E1, essay: ESSAY }, { config: relayConfig, fetchImpl: notJson, pageProtocol: "http:" })).rejects.toMatchObject({ kind: "format" });
    expect(notJson).toHaveBeenCalledTimes(2); // 형식 오류만 1회 더 부른다

    const denied = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: `invalid api key ${KEY}`, type: "authentication_error", code: "invalid_api_key" } }), { status: 401 }),
    );
    const err = await runTask(essayGradeTask, { item: E1, essay: ESSAY }, { config: { ...relayConfig, baseUrl: LG_DIRECT_BASE, apiKey: KEY }, fetchImpl: denied }).catch((e: AiError) => e);
    expect(err).toMatchObject({ kind: "auth", status: 401 });
    expect((err as AiError).message).not.toContain(KEY);
  });

  it("lgRequestBody는 OpenAI 본가용 필드를 쓰지 않는다", () => {
    const body = lgRequestBody({ prompt: { system: "s", user: "u" }, schema: { type: "object" }, schemaName: "x", maxTokens: 10, model: LG_MODEL });
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(body).toHaveProperty("max_tokens", 10);
  });

  it("사용량: OpenAI 형식(completion_tokens_details)도 읽고, 없으면 null", () => {
    const openaiStyle = readChatCompletion({ model: "m", choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } } });
    expect(openaiStyle.usage).toEqual({ completionTokens: 5, reasoningTokens: 2 });
    expect(readChatCompletion({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }).usage).toBeNull();
  });

  it("모델 목록: 중계 식별 헤더가 없으면 다른 서비스로 보고 실패한다", async () => {
    const list = { object: "list", data: [{ id: LG_MODEL }] };
    const relay = vi.fn(async () => new Response(JSON.stringify(list), { status: 200, headers: { "x-learnlens-relay": "1" } }));
    expect(await lgListModels({ fetchImpl: relay })).toEqual([LG_MODEL]);
    const stranger = vi.fn(async () => new Response(JSON.stringify(list), { status: 200 }));
    await expect(lgListModels({ fetchImpl: stranger })).rejects.toMatchObject({ kind: "unsupported" });
    // 직접 주소는 중계가 아니므로 헤더를 보지 않는다
    expect(await lgListModels({ baseUrl: LG_DIRECT_BASE, apiKey: KEY, fetchImpl: stranger })).toEqual([LG_MODEL]);
  });
});

describe("기본 AI 실행 전 차단", () => {
  it("https 페이지에서는 로컬 중계를 막고, 직접 주소(실연 스크립트)와 http 페이지는 통과한다", () => {
    expect(blockReason(relayConfig, "https:")).toMatchObject({ kind: "unsupported" });
    expect(blockReason(relayConfig, "https:", "list-models")).toMatchObject({ kind: "unsupported" });
    expect(blockReason(relayConfig, "http:")).toBeNull();
    expect(blockReason({ ...relayConfig, baseUrl: LG_DIRECT_BASE, apiKey: KEY })).toBeNull();
  });

  it("키가 없어도 막지 않는다(키는 중계에 있다)", () => {
    expect(blockReason({ provider: "lg", model: LG_MODEL }, "http:")).toBeNull();
  });
});

describe("표시 이름", () => {
  it("기본 AI는 제공자·모델 id 대신 'AI'로만 보이고, 다른 제공자는 그대로", () => {
    expect(modelLabel("lg", LG_MODEL)).toBe("AI");
    expect(modelLabel("gemini", "gemini-x")).toBe("gemini-x");
    expect(providerShortLabel("lg")).toBe("AI");
    expect(providerShortLabel("gemini")).toBe("Google");
    expect(providerLabel("lg")).toBe("AI");
    expect(providerLabel("unknown-x")).toBe("unknown-x");
  });

  it("'제공자 · 모델'은 기본 AI에서 'AI' 하나가 되고, 원본 id가 보이지 않는다", () => {
    expect(providerModelLabel("lg", LG_MODEL)).toBe("AI");
    expect(providerModelLabel("lg", LG_MODEL, true)).toBe("AI");
    expect(providerModelLabel("lg", LG_MODEL)).not.toMatch(/lg|exaone/i);
    expect(providerModelLabel("gemini", "gemini-x")).toBe("Google Gemini · gemini-x");
    expect(providerModelLabel("gemini", "gemini-x", true)).toBe("Google · gemini-x");
    expect(providerModelLabel("unknown-x", "m")).toBe("unknown-x · m");
  });
});

describe("AI 설정 (기본 AI)", () => {
  function mem(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  }

  it("로컬 실행이면 기본 AI, 배포 사이트면 Mock이 기본값", () => {
    expect(defaultProviderFor("localhost")).toBe("lg");
    expect(defaultProviderFor("127.0.0.1")).toBe("lg");
    expect(defaultProviderFor("example.github.io")).toBe("mock");
    const s = createAiSettingsStore({ local: mem(), session: mem() }, "lg");
    s.hydrate();
    expect(s.getSnapshot()).toMatchObject({ provider: "lg", model: LG_MODEL, hasKey: false });
    expect(s.getConfig()).toEqual({ provider: "lg", model: LG_MODEL, baseUrl: undefined, apiKey: undefined });
  });

  it("처음에는 모든 AI 작업(채점·태그·관계·요약)이 기본 AI를 쓴다", () => {
    const s = createAiSettingsStore({ local: mem(), session: mem() }, defaultProviderFor("localhost"));
    s.hydrate();
    for (const task of ["essay-grade", "tag-draft", "relation-draft", "analysis-summary"] as const) {
      expect(s.getConfigFor(task)).toMatchObject({ provider: "lg", model: LG_MODEL });
    }
  });

  it("저장된 선택이 기본값보다 우선한다", () => {
    const local = mem();
    const a = createAiSettingsStore({ local, session: mem() }, "lg");
    a.hydrate();
    a.setProvider("mock");
    const b = createAiSettingsStore({ local, session: mem() }, "lg");
    b.hydrate();
    expect(b.getSnapshot().provider).toBe("mock");
    expect(SETTINGS_KEY).toBe("qa-demo:v3:ai-settings");
  });

  it("OpenAI 호환 주소는 다른 제공자로 새지 않는다", () => {
    const s = createAiSettingsStore({ local: mem(), session: mem() });
    s.hydrate();
    s.setProvider("openai");
    s.setBaseUrl("https://compat.example/v1");
    expect(s.getConfig().baseUrl).toBe("https://compat.example/v1");
    s.setProvider("lg");
    expect(s.getConfig().baseUrl).toBeUndefined();
    s.setTaskSetting("essay-grade", { provider: "lg", model: LG_MODEL });
    expect(s.getConfigFor("essay-grade").baseUrl).toBeUndefined();
  });

  it("작업별 설정의 lg가 복원된다", () => {
    const local = mem();
    const a = createAiSettingsStore({ local, session: mem() }, "lg");
    a.hydrate();
    a.setTaskSetting("tag-draft", { provider: "lg", model: LG_MODEL });
    const b = createAiSettingsStore({ local, session: mem() }, "lg");
    b.hydrate();
    expect(b.getSnapshot().tasks["tag-draft"]).toEqual({ provider: "lg", model: LG_MODEL });
  });
});

describe("AI 초안 복원", () => {
  it("기본 AI 초안을 버리지 않는다", () => {
    const draft = {
      draftId: "d1",
      task: "tag-draft",
      quizId: "quiz-w5",
      dataVersion: "v",
      provider: "lg",
      requestedModel: LG_MODEL,
      responseModel: LG_MODEL,
      promptVersion: "p",
      schemaVersion: "s",
      validatorVersion: "v",
      basisHash: "h",
      input: {},
      createdAt: "2026-11-11T00:00:00Z",
      result: { status: "valid" },
    };
    expect(isAiDraft(draft)).toBe(true);
    expect(isAiDraft({ ...draft, provider: "nope" })).toBe(false);
  });
});

describe("오류 안내", () => {
  it("기본 AI의 네트워크 오류에는 로컬 중계 안내를 붙이고, 다른 경우에는 붙이지 않는다", async () => {
    const { errorHint } = await import("@/lib/ai/capabilities");
    expect(errorHint("lg", new AiError("network", ""))).toContain("npm run ai:proxy");
    expect(errorHint("lg", new AiError("rate-limit", ""))).toBe("");
    expect(errorHint("gemini", new AiError("network", ""))).toBe("");
  });
});
