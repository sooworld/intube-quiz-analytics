import { describe, expect, it } from "vitest";
import { LG_TIMEOUT_MS } from "@/lib/ai/providers/lg";
import { AI_TASK_IDS } from "@/lib/ai/task";
import { AiError, aiErrorText, isRetryable } from "@/lib/ai/types";
import { formatSeconds, timeoutMsFor, waitGuide } from "@/lib/ai/wait";

describe("대기 시간 안내", () => {
  it("초를 읽기 쉬운 말로 바꾼다", () => {
    expect(formatSeconds(37)).toBe("37초");
    expect(formatSeconds(60)).toBe("1분");
    expect(formatSeconds(90)).toBe("1분 30초");
    expect(formatSeconds(150)).toBe("2분 30초");
  });

  it("안내하는 한도는 실제 타임아웃과 같다", () => {
    expect(timeoutMsFor("lg")).toBe(LG_TIMEOUT_MS);
    expect(waitGuide("lg", "essay-grade")!.limitSec * 1000).toBe(LG_TIMEOUT_MS);
    expect(waitGuide("gemini", "tag-draft")!.limitSec * 1000).toBe(timeoutMsFor("gemini"));
  });

  it("Mock은 안내가 없고, 기본 AI는 모든 작업에 보통 걸리는 시간이 있다", () => {
    for (const task of AI_TASK_IDS) {
      expect(waitGuide("mock", task)).toBeNull();
      const g = waitGuide("lg", task)!;
      expect(g.typicalSec).toBeGreaterThan(0);
      expect(g.typicalSec!).toBeLessThan(g.limitSec);
    }
  });

  it("다른 제공자는 보통 걸리는 시간을 말하지 않는다(재 본 값이 없다)", () => {
    expect(waitGuide("gemini", "analysis-summary")!.typicalSec).toBeNull();
  });
});

describe("다시 시도할 수 있는 오류", () => {
  it("시간 초과·서버·네트워크는 다시 시도, 키·설정 문제는 아니다", () => {
    for (const kind of ["timeout", "server", "network", "rate-limit", "format", "truncated"] as const) expect(isRetryable(new AiError(kind, "x"))).toBe(true);
    for (const kind of ["missing-key", "auth", "not-found", "bad-request", "unsupported", "aborted", "safety", "refusal"] as const) expect(isRetryable(new AiError(kind, "x"))).toBe(false);
    expect(isRetryable(new Error("x"))).toBe(false);
  });

  it("시간 초과 문구는 고장이 아니라 일시적 지연이라고 알린다", () => {
    expect(aiErrorText(new AiError("timeout", "x"))).toContain("일시적");
  });
});
