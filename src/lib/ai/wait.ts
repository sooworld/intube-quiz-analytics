// AI 대기 시간 안내. 제한 시간을 한곳에서 정해, 화면 안내와 실제 타임아웃이 어긋나지 않게 한다.
import type { ProviderId } from "./types";

/** 제공자 응답 제한 시간 */
export const AI_TIMEOUT_MS = 90_000;

export interface WaitGuide {
  /** 이 시간이 지나면 화면이 기다리기를 멈춘다(초) */
  limitSec: number;
}

/** Mock은 바로 끝나므로 안내가 없다 */
export function waitGuide(provider: ProviderId, timeoutMs: number = AI_TIMEOUT_MS): WaitGuide | null {
  return provider === "mock" ? null : { limitSec: timeoutMs / 1000 };
}

/** 토론 작업의 요청당 제한 시간. 2026-11-26 LG 실연에서 요청당 106~250초가 걸렸다(Codex 균형 검토 5) */
export const FORUM_TIMEOUT_MS = 300_000;

/** 37 → "37초", 90 → "1분 30초", 150 → "2분 30초" */
export function formatSeconds(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}분` : `${m}분 ${r}초`;
}
