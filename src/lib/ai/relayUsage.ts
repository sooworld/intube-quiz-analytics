// AI 중계가 센 호출 수와 하루 예산을 읽는다(중계의 GET /v1/usage, scripts/relay/policy.ts).
// 호출 수는 클라이언트가 세지 않는다. 실패·취소한 호출과 형식 오류 재시도가 빠지기 때문에, 실행마다 ID를 붙여 중계가 센 값을 쓴다.
// 이 파일은 React에 기대지 않는다(훅은 useRelayUsage.ts).
import type { FetchLike } from "./providers/http";
import { LG_DIRECT_BASE, RELAY_CODE_HEADER, relayBase } from "./providers/lg";
import type { ProviderConfig } from "./types";

export interface RelayUsage {
  /** 오늘 중계가 LG로 보낸 호출 수 */
  used: number;
  /** 하루 예산. 중계에 예산이 없으면(로컬) null */
  budget: number | null;
  day: string;
  /** 조회한 실행 ID의 호출 수. 모르면 null */
  runCalls: number | null;
}

const listeners = new Set<() => void>();
let current: RelayUsage | null = null;

/** 마지막으로 읽은 사용량. 화면 여러 곳이 같은 값을 본다 */
export const relayUsageStore = {
  get: () => current,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  set(u: RelayUsage | null) {
    current = u;
    listeners.forEach((l) => l());
  },
};

/** 실행 한 번을 가리키는 ID. 중계가 받는 형식(영숫자·_- 64자 이하)을 지킨다 */
export function newRunId(now = Date.now(), rand: () => number = Math.random): string {
  return `run-${now.toString(36)}-${Math.floor(rand() * 36 ** 6).toString(36)}`;
}

/** 시간 재기. 호출하면 그때부터 지난 ms를 돌려주는 함수를 만든다 */
export function startClock(now: () => number = Date.now): () => number {
  const t = now();
  return () => now() - t;
}

function parseUsage(x: unknown): RelayUsage | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const int = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (!int(o.used) || typeof o.day !== "string") return null;
  if (!(o.budget === null || int(o.budget))) return null;
  if (!(o.runCalls === null || o.runCalls === undefined || int(o.runCalls))) return null;
  return { used: o.used as number, budget: o.budget as number | null, day: o.day, runCalls: (o.runCalls as number | null | undefined) ?? null };
}

/**
 * 중계의 사용량을 읽고 공용 스토어에 올린다. 업스트림을 부르지 않으므로 예산에 들지 않는다.
 * 기본 AI가 아니거나 직접 주소(실연 스크립트)면 null. 읽지 못해도 이전 값은 그대로 둔다.
 */
export async function fetchRunUsage(config: ProviderConfig, runId: string | null, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<RelayUsage | null> {
  if (config.provider !== "lg") return null;
  const base = relayBase(config.baseUrl);
  if (base === null || base === LG_DIRECT_BASE) return null;
  try {
    const res = await fetchImpl(`${base}/usage${runId ? `?run=${encodeURIComponent(runId)}` : ""}`, {
      method: "GET",
      headers: config.relayCode ? { [RELAY_CODE_HEADER]: config.relayCode } : {},
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const u = parseUsage(await res.json());
    if (u) relayUsageStore.set(u);
    return u;
  } catch {
    return null;
  }
}

/** 오늘 남은 호출 수. 예산을 모르면 null */
export function budgetLeft(u: RelayUsage | null): number | null {
  return u && u.budget !== null ? Math.max(0, u.budget - u.used) : null;
}

/** "오늘 호출 7/20". 예산이 없으면 null(로컬은 보여 줄 한도가 없다) */
export function usageLabel(u: RelayUsage | null): string | null {
  return u && u.budget !== null ? `오늘 호출 ${u.used}/${u.budget}` : null;
}

/** 한 번 실행의 결과 문구. 호출 수를 모르면 시간만 */
export function runLabel(calls: number | null, ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  const time = sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분${sec % 60 ? ` ${sec % 60}초` : ""}`;
  return calls === null ? `소요 ${time}` : `호출 ${calls}회 · 소요 ${time}`;
}

/**
 * 일괄 제안의 한도와 재시도. 중계가 예산을 알려 주면 답안 한 건이 재시도로 2호출이 될 수 있어 예산을 한 번에 소진할 수 있으므로,
 * 재시도를 끄고 한 번에 보내는 답안 수를 남은 예산 이하로 줄인다(형식 오류가 난 답안은 개별로 다시 받는다).
 */
export function budgetedBatch(limit: number, usage: RelayUsage | null): { limit: number; retryFormat: boolean } {
  const left = budgetLeft(usage);
  return left === null ? { limit, retryFormat: true } : { limit: Math.min(limit, left), retryFormat: false };
}
