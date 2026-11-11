"use client";
import { useSyncExternalStore } from "react";
import { CAPABILITIES } from "./capabilities";
import { browserAiSettingsStore, type AiSettingsSnapshot } from "./keyStore";

const SERVER_SNAPSHOT: AiSettingsSnapshot = {
  provider: "mock",
  model: CAPABILITIES.mock.defaultModel,
  baseUrl: "",
  relayUrl: "",
  persist: "memory",
  hasKey: false,
  tasks: {},
  storageWarning: null,
};

const subscribe = (fn: () => void) => browserAiSettingsStore().subscribe(fn);
const getSnapshot = () => browserAiSettingsStore().getSnapshot();
const getServerSnapshot = () => SERVER_SNAPSHOT;

/** 화면용 설정 스냅숏(키 자체는 없음). 요청할 때는 browserAiSettingsStore().getConfig()로 키를 꺼낸다 */
export function useAiSettings(): AiSettingsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
