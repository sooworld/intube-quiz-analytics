// 공개 중계 클라이언트: 중계 주소 정규화·차단 규칙·접속 코드 보관·중계 오류 구분·실행 ID별 호출 수·일괄 제안 한도.
import { describe, expect, it, vi } from "vitest";
import { blockReason } from "@/lib/ai/capabilities";
import { runBatch } from "@/lib/ai/batch";
import { createAiSettingsStore, SESSION_KEY, SETTINGS_KEY, type StorageLike } from "@/lib/ai/keyStore";
import { LG_DIRECT_BASE, LG_MODEL, LG_RELAY_BASE, lgGenerate, lgListModels, relayBase } from "@/lib/ai/providers/lg";
import { budgetedBatch, budgetLeft, fetchRunUsage, newRunId, relayUsageStore, runLabel, startClock, usageLabel, type RelayUsage } from "@/lib/ai/relayUsage";
import { AI_ERROR_TEXT, AiError, isRetryable, type ProviderConfig } from "@/lib/ai/types";

const CODE = "demo-code-0123456789abcdef";
const REQ = { prompt: { system: "s", user: "u" }, schema: { type: "object" }, schemaName: "x", maxTokens: 10, model: LG_MODEL, apiKey: "" };
const lgChat = (content: string) => new Response(JSON.stringify({ model: LG_MODEL, choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
const relayError = (status: number, code: string) => new Response(JSON.stringify({ error: { message: "m", code } }), { status });

describe("중계 주소 정규화", () => {
  it("비우면 로컬 중계, 출처만 받고 끝의 / 와 /v1은 한 번만 남긴다", () => {
    expect(relayBase(undefined)).toBe(LG_RELAY_BASE);
    expect(relayBase("  ")).toBe(LG_RELAY_BASE);
    for (const input of ["https://cs-8787.app.github.dev", "https://cs-8787.app.github.dev/", "https://cs-8787.app.github.dev/v1", "https://cs-8787.app.github.dev/v1/", " https://cs-8787.app.github.dev "]) {
      expect(relayBase(input)).toBe("https://cs-8787.app.github.dev/v1");
    }
    expect(relayBase("http://localhost:8787")).toBe("http://localhost:8787/v1");
    expect(relayBase(LG_DIRECT_BASE)).toBe(LG_DIRECT_BASE);
  });

  it("주소 형식이 틀리거나 경로가 더 있으면 null", () => {
    for (const bad of ["not a url", "ftp://x.example", "https://x.example/other", "https://x.example/v1/extra", "javascript:alert(1)"]) expect(relayBase(bad)).toBeNull();
  });
});

describe("차단 규칙 (기본 AI 중계 주소)", () => {
  const lg = (baseUrl?: string): ProviderConfig => ({ provider: "lg", model: LG_MODEL, baseUrl });

  it("https 사이트에서 주소를 비우면 설정 안내와 함께 막는다. http 페이지(로컬 개발)는 통과", () => {
    expect(blockReason(lg(), "https:")).toMatchObject({ kind: "unsupported", message: expect.stringContaining("AI 설정") });
    expect(blockReason(lg(), "http:")).toBeNull();
  });

  it("https 중계 주소는 https 사이트에서도 통과하고, http 중계 주소는 https 사이트에서 막는다", () => {
    expect(blockReason(lg("https://cs-8787.app.github.dev"), "https:")).toBeNull();
    expect(blockReason(lg("http://example.test:8787"), "https:")).toMatchObject({ kind: "unsupported", message: expect.stringContaining("https") });
    expect(blockReason(lg("http://example.test:8787"), "http:")).toBeNull();
  });

  it("주소 형식 오류는 어느 페이지에서든 막는다. 실연 스크립트의 직접 주소는 통과", () => {
    expect(blockReason(lg("https://x.example/other"), "http:")).toMatchObject({ kind: "unsupported" });
    expect(blockReason(lg("not a url"), "https:", "list-models")).toMatchObject({ kind: "unsupported" });
    expect(blockReason(lg(LG_DIRECT_BASE), "https:")).toBeNull();
  });
});

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("중계 주소와 접속 코드 보관", () => {
  it("기본 AI의 설정에는 주소가 중계 주소로, 키 자리의 값이 접속 코드로 실린다(API 키가 아니다)", () => {
    const s = createAiSettingsStore({ local: mem(), session: mem() }, "lg");
    s.hydrate();
    s.setRelayUrl("https://cs-8787.app.github.dev");
    s.setKey(CODE);
    expect(s.getConfig()).toEqual({ provider: "lg", model: LG_MODEL, baseUrl: "https://cs-8787.app.github.dev", relayCode: CODE });
    expect(s.getConfig().apiKey).toBeUndefined();
    expect(s.getSnapshot()).toMatchObject({ relayUrl: "https://cs-8787.app.github.dev", hasKey: true });
    s.setTaskSetting("tag-draft", { provider: "lg", model: LG_MODEL });
    expect(s.getConfigFor("tag-draft")).toMatchObject({ baseUrl: "https://cs-8787.app.github.dev", relayCode: CODE });
  });

  it("접속 코드는 localStorage에 쓰지 않고, 주소는 기억한다", () => {
    const local = mem();
    const s = createAiSettingsStore({ local, session: mem() }, "lg");
    s.hydrate();
    s.setRelayUrl("https://cs-8787.app.github.dev");
    s.setKey(CODE);
    expect([...local.data.values()].join()).not.toContain(CODE);
    expect(local.data.get(SETTINGS_KEY)).toContain("cs-8787.app.github.dev");
    const again = createAiSettingsStore({ local, session: mem() }, "lg");
    again.hydrate();
    expect(again.getSnapshot().relayUrl).toBe("https://cs-8787.app.github.dev");
    expect(again.getSnapshot().hasKey).toBe(false); // 메모리 보관이라 새 세션에는 없다
  });

  it("주소를 바꾸면 이전 주소용 접속 코드를 지운다(다른 곳으로 같은 코드를 보내지 않는다)", () => {
    const session = mem();
    const s = createAiSettingsStore({ local: mem(), session }, "lg");
    s.hydrate();
    s.setRelayUrl("https://a.example");
    s.setPersist("session");
    s.setKey(CODE);
    expect(session.data.get(SESSION_KEY)).toContain(CODE);
    s.setRelayUrl("https://b.example");
    expect(s.getSnapshot().hasKey).toBe(false);
    expect(session.data.has(SESSION_KEY)).toBe(false);
    s.setRelayUrl("https://b.example"); // 같은 값이면 아무것도 하지 않는다
    s.setKey(CODE);
    s.setRelayUrl("https://b.example");
    expect(s.getSnapshot().hasKey).toBe(true);
  });

  it("sessionStorage의 코드는 저장 당시의 주소와 같을 때만 복원한다", () => {
    const local = mem();
    const session = mem();
    const a = createAiSettingsStore({ local, session }, "lg");
    a.hydrate();
    a.setRelayUrl("https://a.example");
    a.setPersist("session");
    a.setKey(CODE);
    const same = createAiSettingsStore({ local, session }, "lg");
    same.hydrate();
    expect(same.getSnapshot().hasKey).toBe(true);
    // 주소가 다른 설정으로 열리면 쓰지 않고 지운다
    local.setItem(SETTINGS_KEY, JSON.stringify({ provider: "lg", models: {}, baseUrl: "", relayUrl: "https://evil.example", tasks: {} }));
    const other = createAiSettingsStore({ local, session }, "lg");
    other.hydrate();
    expect(other.getSnapshot().hasKey).toBe(false);
    expect(session.data.has(SESSION_KEY)).toBe(false);
  });

  it("OpenAI 호환 주소와 중계 주소는 서로 새지 않는다", () => {
    const s = createAiSettingsStore({ local: mem(), session: mem() });
    s.hydrate();
    s.setRelayUrl("https://relay.example");
    s.setProvider("openai");
    s.setBaseUrl("https://compat.example/v1");
    expect(s.getConfig().baseUrl).toBe("https://compat.example/v1");
    s.setProvider("lg");
    expect(s.getConfig().baseUrl).toBe("https://relay.example");
  });
});

describe("기본 AI 어댑터: 접속 코드·실행 ID와 중계 오류", () => {
  it("중계에는 접속 코드와 실행 ID를 헤더로 싣고 키(Authorization)는 싣지 않는다. 주소는 정규화된다", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => lgChat("{}"));
    await lgGenerate({ ...REQ, baseUrl: "https://cs-8787.app.github.dev/", relayCode: CODE, runId: "run-abc", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://cs-8787.app.github.dev/v1/chat/completions");
    expect(init!.headers).toMatchObject({ "x-relay-code": CODE, "x-relay-run": "run-abc" });
    expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
    expect(String(init!.body)).not.toContain(CODE);
  });

  it("접속 코드·잠금·예산 오류를 본문의 error.code로 구분한다", async () => {
    const cases: [number, string, string][] = [
      [401, "relay_auth", "relay-auth"],
      [429, "relay_locked", "relay-locked"],
      [429, "relay_budget", "relay-budget"],
      [503, "relay_storage", "server"],
    ];
    for (const [status, code, kind] of cases) {
      const fetchImpl = async () => relayError(status, code);
      await expect(lgGenerate({ ...REQ, relayCode: CODE, fetchImpl })).rejects.toMatchObject({ kind, status });
    }
  });

  it("LG 업스트림의 401(코드 없는 본문)은 기존 인증 오류로 남는다. 오류 문구에 접속 코드가 섞이지 않는다", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: `invalid ${CODE}`, code: "invalid_api_key" } }), { status: 401 });
    const err = (await lgGenerate({ ...REQ, relayCode: CODE, apiKey: CODE, fetchImpl }).catch((e: AiError) => e)) as AiError;
    expect(err.kind).toBe("auth");
    expect(err.message).not.toContain(CODE);
  });

  it("중계 오류는 다시 시도해도 풀리지 않으므로 재시도 대상이 아니다. 문구가 있다", () => {
    for (const kind of ["relay-auth", "relay-locked", "relay-budget"] as const) {
      expect(isRetryable(new AiError(kind, ""))).toBe(false);
      expect(AI_ERROR_TEXT[kind].length).toBeGreaterThan(10);
    }
  });

  it("모델 목록(연결 확인)에도 접속 코드를 싣고, 중계 식별 헤더가 없으면 다른 서비스로 본다", async () => {
    const list = JSON.stringify({ data: [{ id: LG_MODEL }] });
    const seen: Record<string, string>[] = [];
    const relay = async (_u: string, init?: RequestInit) => {
      seen.push(init!.headers as Record<string, string>);
      return new Response(list, { status: 200, headers: { "x-learnlens-relay": "1" } });
    };
    expect(await lgListModels({ baseUrl: "https://r.example", relayCode: CODE, fetchImpl: relay })).toEqual([LG_MODEL]);
    expect(seen[0]).toMatchObject({ "x-relay-code": CODE });
    await expect(lgListModels({ baseUrl: "https://r.example", relayCode: CODE, fetchImpl: async () => new Response(list, { status: 200 }) })).rejects.toMatchObject({ kind: "unsupported" });
    await expect(lgListModels({ baseUrl: "https://r.example", relayCode: "bad", fetchImpl: async () => relayError(401, "relay_auth") })).rejects.toMatchObject({ kind: "relay-auth" });
  });
});

describe("중계가 센 호출 수와 예산", () => {
  const lg = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({ provider: "lg", model: LG_MODEL, baseUrl: "https://r.example", relayCode: CODE, ...over });
  const usage = (over: Partial<RelayUsage> = {}): RelayUsage => ({ used: 7, budget: 20, day: "2026-11-11", runCalls: 2, ...over });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("실행 ID로 사용량을 읽고 공용 스토어에 올린다(접속 코드 헤더 포함)", async () => {
    relayUsageStore.set(null);
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return json(usage());
    };
    const u = await fetchRunUsage(lg(), "run-abc", fetchImpl);
    expect(u).toEqual(usage());
    expect(calls[0]!.url).toBe("https://r.example/v1/usage?run=run-abc");
    expect(calls[0]!.init!.headers).toMatchObject({ "x-relay-code": CODE });
    expect(relayUsageStore.get()).toEqual(usage());
    await fetchRunUsage(lg(), null, async (url) => {
      expect(url).toBe("https://r.example/v1/usage");
      return json(usage({ runCalls: null }));
    });
  });

  it("기본 AI가 아니거나 직접 주소면 부르지 않고, 실패·이상한 응답은 null이며 이전 값을 지우지 않는다", async () => {
    const never = vi.fn(async () => json(usage()));
    expect(await fetchRunUsage({ provider: "gemini", model: "m", apiKey: "k" }, "r", never)).toBeNull();
    expect(await fetchRunUsage(lg({ baseUrl: LG_DIRECT_BASE }), "r", never)).toBeNull();
    expect(await fetchRunUsage(lg({ baseUrl: "bad url" }), "r", never)).toBeNull();
    expect(never).not.toHaveBeenCalled();
    relayUsageStore.set(usage({ used: 3 }));
    expect(await fetchRunUsage(lg(), "r", async () => json({ error: "x" }, 401))).toBeNull();
    expect(await fetchRunUsage(lg(), "r", async () => json({ used: -1, budget: 20, day: "d" }))).toBeNull();
    expect(await fetchRunUsage(lg(), "r", async () => json({ used: "7", budget: 20, day: "d" }))).toBeNull();
    expect(await fetchRunUsage(lg(), "r", async () => Promise.reject(new TypeError("Failed to fetch")))).toBeNull();
    expect(relayUsageStore.get()).toEqual(usage({ used: 3 }));
  });

  it("남은 예산과 표시 문구: 예산이 없으면(로컬) 표시하지 않는다", () => {
    expect(budgetLeft(usage())).toBe(13);
    expect(budgetLeft(usage({ used: 25 }))).toBe(0);
    expect(budgetLeft(usage({ budget: null }))).toBeNull();
    expect(budgetLeft(null)).toBeNull();
    expect(usageLabel(usage())).toBe("오늘 호출 7/20");
    expect(usageLabel(usage({ budget: null }))).toBeNull();
    expect(runLabel(2, 38_400)).toBe("호출 2회 · 소요 38초");
    expect(runLabel(null, 90_000)).toBe("소요 1분 30초");
    expect(runLabel(1, 100)).toBe("호출 1회 · 소요 1초");
  });

  it("실행 ID는 중계가 받는 형식이고 실행마다 다르다. startClock은 지난 시간을 잰다", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    let t = 1000;
    const elapsed = startClock(() => t);
    t = 3500;
    expect(elapsed()).toBe(2500);
  });
});

describe("일괄 제안과 예산", () => {
  const usage = (used: number, budget: number | null): RelayUsage => ({ used, budget, day: "d", runCalls: null });

  it("예산을 모르면 그대로, 예산이 있으면 한도를 남은 예산 이하로 줄이고 형식 오류 재시도를 끈다", () => {
    expect(budgetedBatch(10, null)).toEqual({ limit: 10, retryFormat: true });
    expect(budgetedBatch(10, usage(3, null))).toEqual({ limit: 10, retryFormat: true });
    expect(budgetedBatch(10, usage(0, 20))).toEqual({ limit: 10, retryFormat: false });
    expect(budgetedBatch(10, usage(15, 20))).toEqual({ limit: 5, retryFormat: false });
    expect(budgetedBatch(10, usage(20, 20))).toEqual({ limit: 0, retryFormat: false });
    expect(budgetedBatch(Number.POSITIVE_INFINITY, usage(18, 20))).toEqual({ limit: 2, retryFormat: false });
  });

  const targets = ["a", "b", "c", "d"].map((key) => ({ key }));
  const run = (fail: Record<string, AiError>) => async (t: { key: string }) => {
    if (fail[t.key]) throw fail[t.key];
  };
  const opts = { intervalMs: 0, sleep: async () => {} };

  it("예산 소진은 그 답안을 처리 대기에 남기고 바로 멈춘다(헛되이 실패로 세지 않는다)", async () => {
    const r = await runBatch({ targets, run: run({ b: new AiError("relay-budget", "") }), signal: new AbortController().signal, ...opts });
    expect(r.stop).toBe("budget");
    expect(r.done).toEqual(["a"]);
    expect(r.remaining.map((t) => t.key)).toEqual(["b", "c", "d"]);
    expect(r.failed.map((f) => f.key)).toEqual(["b"]);
  });

  it("접속 코드 오류·잠금도 첫 오류에서 바로 멈추고 남은 답안을 보존한다", async () => {
    for (const kind of ["relay-auth", "relay-locked"] as const) {
      const r = await runBatch({ targets, run: run({ a: new AiError(kind, "") }), signal: new AbortController().signal, ...opts });
      expect(r.stop).toBe("error");
      expect(r.done).toEqual([]);
      expect(r.remaining.map((t) => t.key)).toEqual(["a", "b", "c", "d"]);
    }
  });

  it("기존 동작은 그대로: 형식 오류 같은 일반 오류는 연속 3회까지 이어 간다", async () => {
    const e = new AiError("format", "");
    const r = await runBatch({ targets: [...targets, { key: "e" }], run: run({ a: e, b: e }), signal: new AbortController().signal, ...opts });
    expect(r.stop).toBe("complete");
    expect(r.done).toEqual(["c", "d", "e"]);
    expect(r.failed.map((f) => f.key)).toEqual(["a", "b"]);
  });
});
