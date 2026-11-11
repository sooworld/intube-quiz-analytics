// AI 대기 시간 안내. 제한 시간과 "보통 걸리는 시간"을 한곳에서 정해, 화면 안내와 실제 타임아웃이 어긋나지 않게 한다.
import { LG_TIMEOUT_MS } from "./providers/lg";
import type { AiTaskId } from "./task";
import type { ProviderId } from "./types";

/** 기본 AI 외 제공자의 응답 제한 시간 */
const DEFAULT_TIMEOUT_MS = 90_000;

export function timeoutMsFor(provider: Exclude<ProviderId, "mock">): number {
  return provider === "lg" ? LG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

/**
 * 기본 AI가 작업 하나에 보통 걸리는 시간(초). 2026-11-11 실측, 호출 1건 기준.
 * 다른 제공자는 재 본 값이 적고 모델마다 달라 안내하지 않는다.
 */
const LG_TYPICAL_SECONDS: Record<AiTaskId, number> = {
  "essay-grade": 60,
  "tag-draft": 120,
  "relation-draft": 170,
  "analysis-summary": 120,
};

export interface WaitGuide {
  /** 보통 걸리는 시간(초). 모르면 null */
  typicalSec: number | null;
  /** 이 시간이 지나면 화면이 기다리기를 멈춘다(초) */
  limitSec: number;
}

/** Mock은 바로 끝나므로 안내가 없다 */
export function waitGuide(provider: ProviderId, task: AiTaskId): WaitGuide | null {
  if (provider === "mock") return null;
  return { typicalSec: provider === "lg" ? LG_TYPICAL_SECONDS[task] : null, limitSec: timeoutMsFor(provider) / 1000 };
}

/** 37 → "37초", 90 → "1분 30초", 150 → "2분 30초" */
export function formatSeconds(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}분` : `${m}분 ${r}초`;
}
