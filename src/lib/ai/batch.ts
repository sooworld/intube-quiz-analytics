// 일괄 제안 실행기 (계획 T3, docs/decisions.md §6.2).
// 동시 1건, 요청 사이 간격, 한 번 실행에 최대 limit건. 429면 멈추고 남은 대상을 돌려준다(교수가 재개).
import { AiError } from "./types";

export interface BatchTarget {
  key: string;
}

export type BatchStop = "complete" | "limit" | "rate-limit" | "budget" | "aborted" | "error";

export interface BatchResult<T extends BatchTarget> {
  stop: BatchStop;
  done: string[];
  failed: { key: string; error: AiError }[];
  /** 아직 처리하지 않은 대상 (재개할 때 그대로 넘긴다) */
  remaining: T[];
}

export interface BatchOptions<T extends BatchTarget> {
  targets: T[];
  run: (target: T, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  limit?: number;
  intervalMs?: number;
  /** 같은 오류가 이만큼 이어지면 멈춘다(키 오류 등으로 모든 요청이 실패하는 경우) */
  maxConsecutiveErrors?: number;
  onProgress?: (p: { done: number; failed: number; total: number; current: string | null }) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AiError("aborted", "취소했습니다."));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AiError("aborted", "취소했습니다."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const STOP_IMMEDIATELY = new Set(["auth", "missing-key", "unsupported", "not-found"]);

export async function runBatch<T extends BatchTarget>(opts: BatchOptions<T>): Promise<BatchResult<T>> {
  const limit = opts.limit ?? 10;
  const interval = opts.intervalMs ?? 1500;
  const maxErr = opts.maxConsecutiveErrors ?? 3;
  const sleep = opts.sleep ?? abortableSleep;
  const queue = [...opts.targets];
  const done: string[] = [];
  const failed: { key: string; error: AiError }[] = [];
  let consecutive = 0;
  let processed = 0;
  const total = Math.min(limit, queue.length);
  const progress = (current: string | null) => opts.onProgress?.({ done: done.length, failed: failed.length, total, current });

  while (queue.length > 0) {
    if (opts.signal.aborted) return { stop: "aborted", done, failed, remaining: queue };
    if (processed >= limit) return { stop: "limit", done, failed, remaining: queue };
    if (processed > 0) {
      try {
        await sleep(interval, opts.signal);
      } catch {
        return { stop: "aborted", done, failed, remaining: queue };
      }
    }
    const target = queue[0]!;
    progress(target.key);
    try {
      await opts.run(target, opts.signal);
      queue.shift();
      done.push(target.key);
      consecutive = 0;
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError("network", "알 수 없는 오류가 났습니다.");
      if (e.kind === "aborted" || opts.signal.aborted) return { stop: "aborted", done, failed, remaining: queue };
      // 429는 실패로 치지 않고 그 대상부터 재개할 수 있게 남겨 둔다
      if (e.kind === "rate-limit") return { stop: "rate-limit", done, failed: [...failed, { key: target.key, error: e }], remaining: queue };
      // 중계의 접속 코드·잠금·예산 오류는 답안 내용 때문이 아니므로 그 대상을 남기고 바로 멈춘다(다른 사용자가 예산을 쓴 경우에도 답안을 헛되이 실패로 세지 않는다)
      if (e.kind === "relay-budget") return { stop: "budget", done, failed: [...failed, { key: target.key, error: e }], remaining: queue };
      if (e.kind === "relay-auth" || e.kind === "relay-locked") return { stop: "error", done, failed: [...failed, { key: target.key, error: e }], remaining: queue };
      queue.shift();
      failed.push({ key: target.key, error: e });
      consecutive++;
      if (STOP_IMMEDIATELY.has(e.kind) || consecutive >= maxErr) {
        progress(null);
        return { stop: "error", done, failed, remaining: queue };
      }
    }
    processed++;
  }
  progress(null);
  return { stop: "complete", done, failed, remaining: [] };
}
