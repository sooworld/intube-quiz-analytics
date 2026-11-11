// 중계의 허용 규칙·접속 코드·인증 실패 잠금·하루 예산 장부 (scripts/relay/policy.ts). 네트워크를 쓰지 않는다.
import { describe, expect, it } from "vitest";
import {
  AUTH_FAIL_LIMIT,
  AUTH_LOCK_MS,
  AUTH_WINDOW_MS,
  checkRequest,
  cleanRunId,
  codeMatches,
  createAuthGuard,
  createLedger,
  DEFAULT_ORIGINS,
  LOOPBACK_HOSTS,
  parseOrigins,
  parseRelayConfig,
  preflightHeaders,
  responseHeaders,
  RUN_HISTORY,
  routeFor,
  seoulDay,
  type IncomingInfo,
  type LedgerStore,
  type RelayConfig,
} from "../scripts/relay/policy";

const LOCAL: RelayConfig = { host: "127.0.0.1", origins: DEFAULT_ORIGINS, hosts: LOOPBACK_HOSTS, code: null, budget: null };
const CODE = "demo-code-0123456789abcdef";
const PUBLIC: RelayConfig = { host: "0.0.0.0", origins: ["https://owner.github.io"], hosts: [...LOOPBACK_HOSTS, "cs-8787.app.github.dev"], code: CODE, budget: 20 };

const ok: IncomingInfo = { method: "POST", path: "/v1/chat/completions", host: "127.0.0.1:8787", origin: "http://localhost:3000", contentType: "application/json", contentLength: 100 };
const pub: IncomingInfo = { ...ok, host: "cs-8787.app.github.dev", origin: "https://owner.github.io", code: CODE };

describe("설정 (환경변수)", () => {
  it("아무것도 없으면 로컬 기본값: 루프백, 코드·예산 없음", () => {
    const r = parseRelayConfig({});
    expect(r).toMatchObject({ ok: true, config: { host: "127.0.0.1", code: null, budget: null, origins: DEFAULT_ORIGINS } });
  });

  it("루프백이 아닌 곳에 열 때 코드·예산·허용 Origin이 하나라도 없으면 시작하지 않는다", () => {
    const base = { RELAY_HOST: "0.0.0.0", AI_RELAY_CODE: CODE, AI_RELAY_BUDGET: "20", AI_RELAY_ORIGINS: "https://owner.github.io" };
    expect(parseRelayConfig(base).ok).toBe(true);
    for (const missing of ["AI_RELAY_CODE", "AI_RELAY_BUDGET", "AI_RELAY_ORIGINS"]) {
      const env: Record<string, string | undefined> = { ...base, [missing]: undefined };
      const r = parseRelayConfig(env);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.problems.join(" ")).toContain(missing);
    }
  });

  it("접속 코드는 16자 이상, 예산은 1 이상의 정수", () => {
    const env = { RELAY_HOST: "0.0.0.0", AI_RELAY_BUDGET: "20", AI_RELAY_ORIGINS: "https://owner.github.io" };
    expect(parseRelayConfig({ ...env, AI_RELAY_CODE: "short" }).ok).toBe(false);
    for (const budget of ["0", "-1", "2.5", "abc", "1e3"]) expect(parseRelayConfig({ AI_RELAY_BUDGET: budget }).ok).toBe(false);
    expect(parseRelayConfig({ AI_RELAY_BUDGET: "20" })).toMatchObject({ ok: true, config: { budget: 20 } });
  });

  it("Codespaces 전달 주소를 Host 허용 목록에 더하고, RELAY_ALLOWED_HOSTS도 받는다", () => {
    const r = parseRelayConfig({ CODESPACE_NAME: "My-Space", GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev", RELAY_ALLOWED_HOSTS: " Extra.example:8787 , " });
    expect(r.ok && r.config.hosts).toEqual([...LOOPBACK_HOSTS, "my-space-8787.app.github.dev", "extra.example:8787"]);
  });

  it("허용 Origin 목록은 환경변수로 바꿀 수 있다", () => {
    expect(parseOrigins(undefined)).toEqual(DEFAULT_ORIGINS);
    expect(parseOrigins(" http://localhost:3001/ , ")).toEqual(["http://localhost:3001"]);
  });
});

describe("요청 판정 (로컬: 접속 코드 없음)", () => {
  const guard = () => createAuthGuard();

  it("앱에서 온 JSON POST와 모델 목록·사용량 GET, 사전 요청을 허용한다", () => {
    expect(checkRequest(ok, LOCAL, guard())).toMatchObject({ ok: true, route: { kind: "forward", method: "POST" } });
    expect(checkRequest({ ...ok, method: "GET", path: "/v1/models", contentType: undefined, contentLength: 0 }, LOCAL, guard())).toMatchObject({ ok: true });
    expect(checkRequest({ ...ok, method: "GET", path: "/v1/usage", contentType: undefined, contentLength: 0 }, LOCAL, guard())).toMatchObject({ ok: true, route: { kind: "usage" } });
    expect(checkRequest({ ...ok, method: "OPTIONS", contentType: undefined }, LOCAL, guard())).toMatchObject({ ok: true, route: { kind: "preflight" } });
    expect(checkRequest({ ...ok, contentType: "application/json; charset=utf-8", host: "localhost:8787" }, LOCAL, guard())).toMatchObject({ ok: true });
  });

  it("다른 Origin, Origin 없음·null, 다른 포트의 localhost를 CORS 헤더 없이 거부한다", () => {
    for (const origin of ["https://evil.example", undefined, "null", "http://localhost:5173", "http://localhost:3000.evil.example"]) {
      expect(checkRequest({ ...ok, origin }, LOCAL, guard())).toMatchObject({ ok: false, status: 403, cors: false });
    }
  });

  it("Host가 중계 주소가 아니면 거부한다(DNS 리바인딩)", () => {
    expect(checkRequest({ ...ok, host: "evil.example:8787" }, LOCAL, guard())).toMatchObject({ ok: false, status: 403, cors: false });
    expect(checkRequest({ ...ok, host: undefined }, LOCAL, guard())).toMatchObject({ ok: false, status: 403 });
  });

  it("JSON이 아닌 POST(사전 요청 없는 단순 요청)와 큰 본문, 없는 경로·메서드를 거부한다", () => {
    expect(checkRequest({ ...ok, contentType: "text/plain" }, LOCAL, guard())).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...ok, contentType: undefined }, LOCAL, guard())).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...ok, contentLength: 2_000_000 }, LOCAL, guard())).toMatchObject({ ok: false, status: 413 });
    expect(checkRequest({ ...ok, path: "/v1/embeddings" }, LOCAL, guard())).toMatchObject({ ok: false, status: 404 });
    expect(routeFor("GET", "/v1/chat/completions")).toBeNull();
    expect(routeFor("DELETE", "/v1/models")).toBeNull();
    expect(routeFor("POST", "/v1/usage")).toBeNull();
  });
});

describe("접속 코드", () => {
  it("공개 설정: 코드가 맞아야 통과하고, 없음·틀림은 허용 Origin이므로 CORS 헤더를 붙인 401이다", () => {
    const g = createAuthGuard();
    expect(checkRequest(pub, PUBLIC, g)).toMatchObject({ ok: true });
    for (const code of [undefined, "", "wrong", CODE + "x", CODE.slice(0, -1)]) {
      expect(checkRequest({ ...pub, code }, PUBLIC, g, 0)).toMatchObject({ ok: false, status: 401, code: "relay_auth", cors: true, origin: "https://owner.github.io" });
    }
  });

  it("사전 요청은 코드 없이 통과하지만 Origin·Host·경로 검사는 거친다", () => {
    const pre = { ...pub, method: "OPTIONS", code: undefined, contentType: undefined };
    expect(checkRequest(pre, PUBLIC, createAuthGuard())).toMatchObject({ ok: true, route: { kind: "preflight" } });
    expect(checkRequest({ ...pre, origin: "https://evil.example" }, PUBLIC, createAuthGuard())).toMatchObject({ ok: false, status: 403, cors: false });
    expect(checkRequest({ ...pre, path: "/v1/other" }, PUBLIC, createAuthGuard())).toMatchObject({ ok: false, status: 404 });
  });

  it("모델 목록·사용량도 코드를 요구한다", () => {
    for (const path of ["/v1/models", "/v1/usage"]) {
      const get = { ...pub, method: "GET", path, contentType: undefined, contentLength: 0 };
      expect(checkRequest(get, PUBLIC, createAuthGuard())).toMatchObject({ ok: true });
      expect(checkRequest({ ...get, code: undefined }, PUBLIC, createAuthGuard())).toMatchObject({ ok: false, status: 401 });
    }
  });

  it("허용하지 않은 Origin은 코드가 틀려도 401이 아니라 403(CORS 없음)이고, 인증 실패로 세지 않는다", () => {
    const g = createAuthGuard();
    for (let i = 0; i < 10; i++) expect(checkRequest({ ...pub, origin: "https://evil.example", code: "wrong" }, PUBLIC, g, i)).toMatchObject({ ok: false, status: 403, cors: false });
    expect(checkRequest(pub, PUBLIC, g, 11)).toMatchObject({ ok: true });
  });

  it("codeMatches: 길이가 달라도 안전하게 비교하고 undefined는 거부한다", () => {
    expect(codeMatches(CODE, CODE)).toBe(true);
    expect(codeMatches(CODE, undefined)).toBe(false);
    expect(codeMatches(CODE, "")).toBe(false);
    expect(codeMatches(CODE, CODE + "0")).toBe(false);
  });
});

describe("인증 실패 잠금", () => {
  it(`1분에 ${AUTH_FAIL_LIMIT}번 틀리면 올바른 코드도 ${AUTH_LOCK_MS / 1000}초 동안 막고(429 relay_locked), 지나면 풀린다`, () => {
    const g = createAuthGuard();
    for (let i = 0; i < AUTH_FAIL_LIMIT; i++) expect(checkRequest({ ...pub, code: "wrong" }, PUBLIC, g, 1000 + i)).toMatchObject({ status: 401 });
    expect(checkRequest(pub, PUBLIC, g, 2000)).toMatchObject({ ok: false, status: 429, code: "relay_locked", cors: true });
    expect(checkRequest(pub, PUBLIC, g, 1004 + AUTH_LOCK_MS - 1)).toMatchObject({ status: 429 });
    expect(checkRequest(pub, PUBLIC, g, 1004 + AUTH_LOCK_MS)).toMatchObject({ ok: true });
  });

  it("창 밖의 오래된 실패는 쌓이지 않는다", () => {
    const g = createAuthGuard();
    for (let i = 0; i < AUTH_FAIL_LIMIT - 1; i++) g.fail(i * 1000);
    g.fail(AUTH_FAIL_LIMIT * 1000 + AUTH_WINDOW_MS); // 앞선 실패들은 모두 창 밖
    expect(g.isLocked(AUTH_FAIL_LIMIT * 1000 + AUTH_WINDOW_MS + 1)).toBe(false);
  });

  it("코드를 요구하지 않는 로컬 설정에는 잠금이 없다", () => {
    const g = createAuthGuard();
    for (let i = 0; i < 20; i++) expect(checkRequest({ ...ok, code: "anything" }, LOCAL, g, i)).toMatchObject({ ok: true });
  });
});

describe("응답 헤더와 실행 ID", () => {
  it("사전 요청은 접속 코드·실행 ID 헤더를 허용하고, 실제 응답은 Allow-Origin과 노출 헤더를 붙인다", () => {
    const pre = preflightHeaders("https://owner.github.io");
    expect(pre["access-control-allow-headers"]).toContain("x-relay-code");
    expect(pre["access-control-allow-headers"]).toContain("x-relay-run");
    const h = responseHeaders("https://owner.github.io");
    expect(h["access-control-allow-origin"]).toBe("https://owner.github.io");
    expect(h["access-control-expose-headers"]).toContain("x-day-rate-limit-remaining");
    expect(h["x-learnlens-relay"]).toBe("1");
  });

  it("실행 ID는 영숫자·_-로 64자까지만 받는다", () => {
    expect(cleanRunId("run-abc_123")).toBe("run-abc_123");
    expect(cleanRunId("a".repeat(64))).toBe("a".repeat(64));
    for (const bad of [undefined, "", "a".repeat(65), "has space", "a/b", "<script>"]) expect(cleanRunId(bad)).toBeNull();
    expect(checkRequest({ ...ok, runId: "run-1" }, LOCAL, createAuthGuard())).toMatchObject({ ok: true, runId: "run-1" });
    expect(checkRequest({ ...ok, runId: "bad id" }, LOCAL, createAuthGuard())).toMatchObject({ ok: true, runId: null });
  });
});

function memoryStore(initial: string | null = null): LedgerStore & { text: string | null; failWrites: boolean; failRead: boolean; writes: number } {
  const s = {
    text: initial,
    failWrites: false,
    failRead: false,
    writes: 0,
    load() {
      if (s.failRead) throw new Error("읽기 실패");
      return s.text;
    },
    save(t: string) {
      if (s.failWrites) throw new Error("쓰기 실패");
      s.text = t;
      s.writes++;
    },
  };
  return s;
}

describe("하루 예산 장부", () => {
  const day = (d: string) => () => new Date(`${d}T03:00:00+09:00`);

  it("예산만큼 허용하고 그 다음부터 relay_budget으로 막는다. 막힌 요청은 세지 않는다", () => {
    const store = memoryStore();
    const l = createLedger({ budget: 2, store, now: day("2026-11-11") });
    expect(l.reserve("a")).toEqual({ ok: true, used: 1 });
    expect(l.reserve("a")).toEqual({ ok: true, used: 2 });
    expect(l.reserve("b")).toMatchObject({ ok: false, code: "relay_budget" });
    expect(l.usage(null)).toMatchObject({ used: 2, budget: 2 });
    expect(JSON.parse(store.text!)).toEqual({ date: "2026-11-11", used: 2 });
  });

  it("기록은 전송 전에 남고, 재시작해도 같은 날이면 이어진다", () => {
    const store = memoryStore();
    createLedger({ budget: 5, store, now: day("2026-11-11") }).reserve(null);
    createLedger({ budget: 5, store, now: day("2026-11-11") });
    const again = createLedger({ budget: 5, store, now: day("2026-11-11") });
    expect(again.usage(null).used).toBe(1);
  });

  it("서울 날짜가 바뀌면 0부터 다시 센다(저장된 이전 날짜 기록도 무시)", () => {
    let now = new Date("2026-11-11T23:59:00+09:00");
    const store = memoryStore(JSON.stringify({ date: "2026-11-10", used: 99 }));
    const l = createLedger({ budget: 3, store, now: () => now });
    expect(l.usage(null).used).toBe(0);
    l.reserve(null);
    l.reserve(null);
    now = new Date("2026-11-12T00:01:00+09:00");
    expect(l.usage(null)).toMatchObject({ used: 0, day: "2026-11-12" });
    expect(l.reserve(null)).toEqual({ ok: true, used: 1 });
    expect(seoulDay(new Date("2026-11-11T15:30:00Z"))).toBe("2026-11-12"); // UTC 15:30 = 서울 다음 날 00:30
  });

  it("기록 파일이 손상되었거나 읽을 수 없으면 요청을 막는다(fail closed)", () => {
    for (const bad of ["not json", "{}", JSON.stringify({ date: "2026-11-11", used: -1 }), JSON.stringify({ date: "2026-11-11", used: 1.5 }), JSON.stringify({ date: 20261111, used: 1 })]) {
      const l = createLedger({ budget: 5, store: memoryStore(bad), now: day("2026-11-11") });
      expect(l.reserve(null)).toMatchObject({ ok: false, code: "relay_storage" });
    }
    const unreadable = memoryStore();
    unreadable.failRead = true;
    expect(createLedger({ budget: 5, store: unreadable, now: day("2026-11-11") }).reserve(null)).toMatchObject({ ok: false, code: "relay_storage" });
  });

  it("기록을 쓰지 못하면 그 요청을 막고 세지 않는다", () => {
    const store = memoryStore();
    const l = createLedger({ budget: 5, store, now: day("2026-11-11") });
    l.reserve("a");
    store.failWrites = true;
    expect(l.reserve("a")).toMatchObject({ ok: false, code: "relay_storage" });
    expect(l.usage("a")).toMatchObject({ used: 1, runCalls: 1 });
    store.failWrites = false;
    expect(l.reserve("a")).toEqual({ ok: true, used: 2 });
  });

  it("예산이 없으면(로컬) 무제한이고 파일을 쓰지 않지만 호출 수는 센다", () => {
    const store = memoryStore();
    const l = createLedger({ budget: null, store, now: day("2026-11-11") });
    for (let i = 0; i < 50; i++) expect(l.reserve(null).ok).toBe(true);
    expect(l.usage(null)).toMatchObject({ used: 50, budget: null });
    expect(store.writes).toBe(0);
  });
});

describe("실행 ID별 호출 수", () => {
  const now = () => new Date("2026-11-11T12:00:00+09:00");

  it("실행마다 따로 센다(탭이 둘이어도 섞이지 않는다). 재시도는 같은 ID라 합산된다", () => {
    const l = createLedger({ budget: null, store: null, now });
    l.reserve("run-a");
    l.reserve("run-b");
    l.reserve("run-a"); // run-a의 형식 오류 재시도
    expect(l.usage("run-a").runCalls).toBe(2);
    expect(l.usage("run-b").runCalls).toBe(1);
    expect(l.usage("run-zzz").runCalls).toBeNull();
    expect(l.usage(null).runCalls).toBeNull();
    expect(l.usage("run-a").used).toBe(3);
  });

  it("예산 때문에 막힌 호출은 실행의 호출 수에 들지 않는다", () => {
    const l = createLedger({ budget: 1, store: memoryStore(), now });
    l.reserve("r");
    expect(l.reserve("r").ok).toBe(false);
    expect(l.usage("r").runCalls).toBe(1);
  });

  it(`기록은 최근 ${RUN_HISTORY}개만 유지한다`, () => {
    const l = createLedger({ budget: null, store: null, now });
    for (let i = 0; i < RUN_HISTORY + 5; i++) l.reserve(`r${i}`);
    expect(l.usage("r0").runCalls).toBeNull();
    expect(l.usage(`r${RUN_HISTORY + 4}`).runCalls).toBe(1);
  });
});
