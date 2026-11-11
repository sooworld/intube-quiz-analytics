"use client";
// 중계의 오늘 사용량을 화면에 보인다. 기본 AI일 때만 읽고, 설정(제공자·중계 주소·접속 코드)이 바뀌면 다시 읽는다.
import { useEffect, useSyncExternalStore } from "react";
import { browserAiSettingsStore } from "./keyStore";
import { fetchRunUsage, relayUsageStore, type RelayUsage } from "./relayUsage";
import { useAiSettings } from "./useAiSettings";

export function useRelayUsage(): RelayUsage | null {
  const ai = useAiSettings();
  const usage = useSyncExternalStore(relayUsageStore.subscribe, relayUsageStore.get, () => null);
  useEffect(() => {
    if (ai.provider !== "lg") return;
    void fetchRunUsage(browserAiSettingsStore().getConfig(), null);
  }, [ai.provider, ai.relayUrl, ai.hasKey]);
  return ai.provider === "lg" ? usage : null;
}
