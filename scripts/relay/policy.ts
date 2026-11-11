// 중계(scripts/ai-proxy.ts)의 허용 규칙·예산 장부. 네트워크 없이 테스트할 수 있게 순수 로직으로 둔다.
// 목적: LG 키로 내 한도를 쓰는 요청을 이 앱에서 온 것만으로 제한한다. 로컬 실행과 공개(시연) 실행 모두 같은 규칙이다.
// - Host: 중계 포트의 로컬 주소(+ 공개 실행이면 전달 주소). 로컬 서버에 대한 DNS 리바인딩을 막는다
// - Origin: 정확히 일치하는 목록만. 없거나 "null"이면 거부(브라우저는 교차 출처 요청에 Origin을 숨길 수 없다)
// - POST: application/json만(사전 요청 없는 "단순 요청"으로 실행되는 것을 막는다)
// - 접속 코드(AI_RELAY_CODE): 설정되어 있으면 모든 실제 요청에 필요. 실패가 이어지면 잠시 막는다
// - 하루 예산(AI_RELAY_BUDGET): 업스트림 chat/completions를 보내는 순간 센다(재시도·실패 포함)
// Origin·Host는 curl로 속일 수 있어 "브라우저에서 온 요청"만 걸러 낸다. 실제 문은 접속 코드이고, 뚫려도 피해는 예산으로 한정된다.
import { createHash, timingSafeEqual } from "node:crypto";
import { LG_TIMEOUT_MS, RELAY_CODE_HEADER, RELAY_HEADER, RELAY_RUN_HEADER } from "../../src/lib/ai/providers/lg";

export { RELAY_HEADER };
export const RELAY_PORT = 8787;
export const UPSTREAM_ORIGIN = "https://api.exaone.ai";
export const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
export const LOOPBACK_HOSTS = [`127.0.0.1:${RELAY_PORT}`, `localhost:${RELAY_PORT}`];
export const MAX_BODY_BYTES = 1_000_000;
/** 업스트림 초당 1건 한도보다 약간 넓게 */
export const MIN_INTERVAL_MS = 1100;
/** 브라우저 쪽 타임아웃보다 조금 길게: 먼저 끊기는 쪽이 브라우저여야 "응답 시간 초과" 문구가 보인다 */
export const UPSTREAM_TIMEOUT_MS = LG_TIMEOUT_MS + 5_000;
export const REMAINING_HEADER = "x-day-rate-limit-remaining";
/** 접속 코드 헤더와 실행 ID 헤더 (클라이언트와 같은 상수: src/lib/ai/providers/lg.ts) */
export const CODE_HEADER = RELAY_CODE_HEADER;
export const RUN_HEADER = RELAY_RUN_HEADER;
export const AUTH_FAIL_LIMIT = 5;
export const AUTH_WINDOW_MS = 60_000;
export const AUTH_LOCK_MS = 60_000;
export const RUN_HISTORY = 200;
export const BUDGET_FILE = ".relay-budget.json";

// ── 설정 ──────────────────────────────────────────────────────────────

export interface RelayConfig {
  host: string;
  origins: string[];
  hosts: string[];
  /** 접속 코드. null이면 코드를 요구하지 않는다(로컬) */
  code: string | null;
  /** 하루 호출 예산. null이면 무제한(LG의 429만) */
  budget: number | null;
}

const isLoopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "::1";

/** AI_RELAY_ORIGINS(쉼표 구분)가 있으면 그 목록, 없으면 기본 목록 */
export function parseOrigins(env: string | undefined): string[] {
  const list = (env ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => s !== "");
  return list.length ? list : DEFAULT_ORIGINS;
}

function parseBudget(raw: string | undefined): number | null | "invalid" {
  const t = raw?.trim();
  if (!t) return null;
  return /^[1-9]\d{0,5}$/.test(t) ? Number(t) : "invalid";
}

export type ConfigResult = { ok: true; config: RelayConfig } | { ok: false; problems: string[] };

/**
 * 환경변수로 설정을 만든다. 루프백이 아닌 곳에 열면(공개 실행) 코드·예산·허용 Origin이 모두 있어야 한다.
 * 하나라도 없으면 시작하지 않는다(실수로 무방비 공개되는 것을 막는다).
 */
export function parseRelayConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = [];
  const host = (env.RELAY_HOST ?? "127.0.0.1").trim();
  const code = env.AI_RELAY_CODE?.trim() || null;
  const budget = parseBudget(env.AI_RELAY_BUDGET);
  if (budget === "invalid") problems.push("AI_RELAY_BUDGET은 1 이상의 정수여야 합니다.");
  const explicitOrigins = !!env.AI_RELAY_ORIGINS?.trim();
  const hosts = [...LOOPBACK_HOSTS];
  // Codespaces 전달 주소: <이름>-<포트>.<도메인>. 전달 프록시가 Host를 바꾸는지는 실제로 측정해 RELAY_ALLOWED_HOSTS로 보탠다
  if (env.CODESPACE_NAME && env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) hosts.push(`${env.CODESPACE_NAME}-${RELAY_PORT}.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`.toLowerCase());
  for (const h of (env.RELAY_ALLOWED_HOSTS ?? "").split(",")) if (h.trim()) hosts.push(h.trim().toLowerCase());
  if (!isLoopback(host)) {
    if (!code) problems.push("루프백이 아닌 곳에 열려면 AI_RELAY_CODE(접속 코드)가 필요합니다.");
    else if (code.length < 16) problems.push("AI_RELAY_CODE는 16자 이상이어야 합니다.");
    if (budget === null) problems.push("루프백이 아닌 곳에 열려면 AI_RELAY_BUDGET(하루 호출 예산)이 필요합니다.");
    if (!explicitOrigins) problems.push("루프백이 아닌 곳에 열려면 AI_RELAY_ORIGINS(허용 Origin)가 필요합니다.");
  }
  if (problems.length || budget === "invalid") return { ok: false, problems };
  return { ok: true, config: { host, origins: parseOrigins(env.AI_RELAY_ORIGINS), hosts, code, budget } };
}

// ── 경로 ──────────────────────────────────────────────────────────────

const ROUTES: Record<string, "GET" | "POST"> = {
  "/v1/models": "GET",
  "/v1/chat/completions": "POST",
  "/v1/usage": "GET",
};

export type Route = { kind: "preflight" } | { kind: "usage" } | { kind: "forward"; method: "GET" | "POST"; path: string };

/** 처리할 경로면 그 정보를, 아니면 null. OPTIONS는 알려진 경로에 대한 사전 요청일 때만 받는다 */
export function routeFor(method: string | undefined, path: string): Route | null {
  const allowed = ROUTES[path];
  if (!allowed) return null;
  if (method === "OPTIONS") return { kind: "preflight" };
  if (method !== allowed) return null;
  return path === "/v1/usage" ? { kind: "usage" } : { kind: "forward", method: allowed, path };
}

// ── 접속 코드와 인증 실패 잠금 ───────────────────────────────────────────

/** 길이가 달라도 같은 시간에 비교한다(해시한 뒤 timingSafeEqual) */
export function codeMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

/** 인증 실패가 AUTH_WINDOW_MS 안에 AUTH_FAIL_LIMIT번이면 AUTH_LOCK_MS 동안 모든 인증 시도를 막는다 */
export function createAuthGuard() {
  let failures: number[] = [];
  let lockedUntil = 0;
  return {
    isLocked: (now: number) => now < lockedUntil,
    fail(now: number) {
      failures = failures.filter((t) => now - t < AUTH_WINDOW_MS);
      failures.push(now);
      if (failures.length >= AUTH_FAIL_LIMIT) {
        lockedUntil = now + AUTH_LOCK_MS;
        failures = [];
      }
    },
  };
}
export type AuthGuard = ReturnType<typeof createAuthGuard>;

// ── 요청 판정 ─────────────────────────────────────────────────────────

export interface IncomingInfo {
  method: string | undefined;
  path: string;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
  contentLength: number;
  code?: string;
  runId?: string;
}

export type RelayErrorCode = "relay_auth" | "relay_locked" | "relay_budget" | "relay_storage";

/**
 * cors가 false인 거부는 CORS 헤더 없이 돌려준다(허용하지 않은 Origin·Host).
 * 허용된 Origin에서 온 인증 실패는 cors가 true라서, 브라우저가 "네트워크 오류"가 아니라 본문을 읽는다.
 */
export type Verdict =
  | { ok: true; origin: string; route: Route; runId: string | null }
  | { ok: false; status: 403 | 404 | 413; reason: string; cors: false }
  | { ok: false; status: 401 | 429; reason: string; code: RelayErrorCode; cors: true; origin: string };

/** 실행 ID는 영숫자·_- 64자까지만 받는다(로그·메모리에 임의 문자열을 쌓지 않기 위해) */
export function cleanRunId(raw: string | undefined): string | null {
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

export function checkRequest(r: IncomingInfo, cfg: RelayConfig, guard: AuthGuard, now = Date.now()): Verdict {
  if (!r.host || !cfg.hosts.includes(r.host.toLowerCase())) return { ok: false, status: 403, reason: "허용하지 않은 Host", cors: false };
  if (!r.origin || r.origin === "null" || !cfg.origins.includes(r.origin)) return { ok: false, status: 403, reason: "허용하지 않은 Origin", cors: false };
  const route = routeFor(r.method, r.path);
  if (!route) return { ok: false, status: 404, reason: "없는 경로", cors: false };
  // 사전 요청은 브라우저가 자동으로 보내며 코드를 실을 수 없다. 경로·Origin 검사만 거친다
  if (route.kind === "preflight") return { ok: true, origin: r.origin, route, runId: null };
  if (route.kind === "forward" && route.method === "POST") {
    const type = (r.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") return { ok: false, status: 403, reason: "POST는 application/json만 받음", cors: false };
    if (r.contentLength > MAX_BODY_BYTES) return { ok: false, status: 413, reason: "본문이 너무 큼", cors: false };
  }
  if (cfg.code !== null) {
    if (guard.isLocked(now)) return { ok: false, status: 429, reason: "인증 실패가 많아 잠시 막혔습니다", code: "relay_locked", cors: true, origin: r.origin };
    if (!codeMatches(cfg.code, r.code)) {
      guard.fail(now);
      return { ok: false, status: 401, reason: "접속 코드가 없거나 틀렸습니다", code: "relay_auth", cors: true, origin: r.origin };
    }
  }
  return { ok: true, origin: r.origin, route, runId: cleanRunId(r.runId) };
}

// ── 응답 헤더 ─────────────────────────────────────────────────────────

/** 허용된 사전 요청(OPTIONS)에 답할 헤더 */
export function preflightHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST",
    "access-control-allow-headers": `content-type, ${CODE_HEADER}, ${RUN_HEADER}`,
    "access-control-max-age": "600",
    vary: "Origin",
    [RELAY_HEADER]: "1",
  };
}

/**
 * 허용된 실제 응답(성공·업스트림 오류·중계 오류 모두)에 붙일 헤더.
 * 오류 응답에도 붙여야 브라우저가 본문과 상태를 보여 준다(없으면 모든 오류가 "네트워크 오류"로 보인다).
 */
export function responseHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-expose-headers": `${RELAY_HEADER}, ${REMAINING_HEADER}`,
    vary: "Origin",
    [RELAY_HEADER]: "1",
  };
}

// ── 하루 예산 장부 ────────────────────────────────────────────────────

/** 서울 날짜 "YYYY-MM-DD" */
export function seoulDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export interface LedgerStore {
  /** 저장된 내용(없으면 null). 읽을 수 없으면 던진다 */
  load(): string | null;
  /** 쓰지 못하면 던진다 */
  save(text: string): void;
}

export interface Usage {
  used: number;
  budget: number | null;
  day: string;
  /** 요청한 실행 ID의 호출 수. ID를 모르거나 기록이 없으면 null */
  runCalls: number | null;
}

export type Reservation = { ok: true; used: number } | { ok: false; code: "relay_budget" | "relay_storage"; reason: string };

/**
 * 업스트림을 보내기 직전에 reserve()를 부른다. 날짜 확인 → 예산 확인 → 기록이 한 동기 구간에서 끝나므로
 * 단일 프로세스에서는 이것이 곧 잠금이다. 예산이 있을 때 기록을 쓰지 못하거나 파일이 손상되었으면 막는다(fail closed).
 * 같은 파일을 쓰는 중계를 둘 이상 띄우는 것은 지원하지 않는다.
 */
export function createLedger(opts: { budget: number | null; store: LedgerStore | null; now?: () => Date }) {
  const now = opts.now ?? (() => new Date());
  const runs = new Map<string, number>();
  let day = seoulDay(now());
  let used = 0;
  let broken: string | null = null;

  if (opts.budget !== null && opts.store) {
    try {
      const text = opts.store.load();
      if (text !== null) {
        const parsed = JSON.parse(text) as { date?: unknown; used?: unknown };
        if (typeof parsed.date !== "string" || typeof parsed.used !== "number" || !Number.isInteger(parsed.used) || parsed.used < 0) throw new Error("형식 오류");
        // 이전 날짜의 기록이면 오늘 0부터 시작한다
        if (parsed.date === day) used = parsed.used;
      }
    } catch {
      broken = "예산 기록을 읽을 수 없습니다. 파일을 확인하세요.";
    }
  }

  function rollDay() {
    const today = seoulDay(now());
    if (today !== day) {
      day = today;
      used = 0;
    }
  }

  return {
    reserve(runId: string | null): Reservation {
      rollDay();
      if (opts.budget !== null) {
        if (broken) return { ok: false, code: "relay_storage", reason: broken };
        if (used >= opts.budget) return { ok: false, code: "relay_budget", reason: "오늘 시연 예산을 다 썼습니다" };
        if (opts.store) {
          try {
            opts.store.save(JSON.stringify({ date: day, used: used + 1 }));
          } catch {
            return { ok: false, code: "relay_storage", reason: "예산 기록을 쓰지 못해 요청을 막았습니다" };
          }
        }
      }
      used++;
      if (runId) {
        runs.set(runId, (runs.get(runId) ?? 0) + 1);
        if (runs.size > RUN_HISTORY) runs.delete(runs.keys().next().value as string);
      }
      return { ok: true, used };
    },
    usage(runId: string | null): Usage {
      rollDay();
      return { used, budget: opts.budget, day, runCalls: runId ? (runs.get(runId) ?? null) : null };
    },
  };
}
export type Ledger = ReturnType<typeof createLedger>;
