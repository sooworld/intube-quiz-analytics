// 현재 브라우저의 개인 키 보관 (계획 T4). 교수별 키 "관리"가 아니라 이 브라우저에서만 쓰는 시연이다.
// - 키는 기본 메모리(새로고침하면 사라짐). 선택하면 sessionStorage(탭을 닫으면 삭제). localStorage에는 두지 않는다
// - 제공자나 base URL을 바꾸면 키를 비운다(다른 곳으로 같은 키를 보내지 않게)
// - 제공자·모델·주소(비밀 아님)는 localStorage에 기억한다
// - 기본 AI(lg)는 LG 키가 브라우저에 없다(중계가 .env·Secret에서 읽음). 키 자리에는 공개 중계의 접속 코드가 들어가고,
//   중계 주소(relayUrl)를 바꾸면 코드를 비운다. 로컬 실행이면 lg, 아니면 mock이 기본값
// 확정 점수 저장(useVersionedStorage)과 수명을 섞지 않으려고 별도 저장소로 둔다.
import { CAPABILITIES } from "./capabilities";
import { AI_TASK_IDS, MOCK_MODEL, type AiTaskId } from "./task";
import { AiError, isProviderId, type ProviderConfig, type ProviderId } from "./types";

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export type KeyPersist = "memory" | "session";

/**
 * 작업별 모델 설정 (docs/decisions.md §8.1 U7). 없으면 공통 설정을 따른다.
 * 키는 공통 제공자의 키 하나만 쓰므로, provider가 공통 제공자와 다르면 실행을 막는다(범위 선택).
 */
export type TaskSetting = { provider: "mock" } | { provider: Exclude<ProviderId, "mock">; model: string };

export interface AiSettingsSnapshot {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  /** 기본 AI 중계 주소(출처). 빈칸이면 로컬 중계 */
  relayUrl: string;
  persist: KeyPersist;
  hasKey: boolean;
  /** 작업별 설정 (없는 작업은 공통 설정을 따름) */
  tasks: Partial<Record<AiTaskId, TaskSetting>>;
  /** 저장소를 쓸 수 없어 기억하지 못했을 때 */
  storageWarning: string | null;
}

// v3(2026-11-11): 모든 AI 초안·채점이 기본 AI로 시작하도록 AI 선호 설정(제공자·모델·주소·작업별 모델)을 다시 초기화했다.
// 이전에 고른 Mock·작업별 모델이 남아 일부 작업만 다른 모델로 도는 일을 막는다. 이전 값은 읽지 않는다
export const SETTINGS_KEY = "qa-demo:v3:ai-settings";
export const SESSION_KEY = "qa-demo:v1:ai-key";

/** 로컬 실행(개발 서버)이면 기본 AI, 공개 배포 사이트면 Mock */
export function defaultProviderFor(hostname: string): ProviderId {
  return hostname === "localhost" || hostname === "127.0.0.1" ? "lg" : "mock";
}

interface StoredSettings {
  provider: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  baseUrl: string;
  relayUrl: string;
  tasks: Partial<Record<AiTaskId, TaskSetting>>;
}

function parseTasks(raw: unknown): Partial<Record<AiTaskId, TaskSetting>> {
  const out: Partial<Record<AiTaskId, TaskSetting>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of AI_TASK_IDS) {
    const t = (raw as Record<string, unknown>)[id];
    if (!t || typeof t !== "object") continue;
    const { provider, model } = t as { provider?: unknown; model?: unknown };
    if (provider === "mock") out[id] = { provider: "mock" };
    else if (isProviderId(provider) && typeof model === "string" && model.trim() !== "") out[id] = { provider, model: model.trim() };
  }
  return out;
}

interface StoredKey {
  provider: ProviderId;
  baseUrl: string;
  key: string;
}

function safe<T>(fn: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

export function createAiSettingsStore(storages: { local: StorageLike | null; session: StorageLike | null }, defaultProvider: ProviderId = "mock") {
  let settings: StoredSettings = { provider: defaultProvider, models: {}, baseUrl: "", relayUrl: "", tasks: {} };
  let key = "";
  let persist: KeyPersist = "memory";
  let warning: string | null = null;
  const listeners = new Set<() => void>();
  let snapshot: AiSettingsSnapshot = build();

  function modelFor(p: ProviderId) {
    // 기본 AI는 모델이 하나뿐이라 고르지 않는다
    return p === "lg" ? CAPABILITIES.lg.defaultModel : (settings.models[p] ?? CAPABILITIES[p].defaultModel);
  }
  /** 제공자마다 자기 주소만 쓴다: OpenAI 호환은 baseUrl, 기본 AI는 relayUrl. 다른 제공자로 주소가 새지 않게 한다 */
  function baseUrlFor(p: ProviderId) {
    if (p === "openai") return settings.baseUrl || undefined;
    if (p === "lg") return settings.relayUrl || undefined;
    return undefined;
  }
  /** 키(기본 AI는 접속 코드)를 묶어 두는 주소. 이 주소가 바뀌면 키를 비운다 */
  function bindingFor(p: ProviderId) {
    return p === "openai" ? settings.baseUrl : p === "lg" ? settings.relayUrl : "";
  }
  /** 키 자리의 값을 어디에 실을지: 기본 AI는 중계 접속 코드(LG 키가 아님), 그 밖에는 API 키 */
  function credentialFor(p: ProviderId): Pick<ProviderConfig, "apiKey" | "relayCode"> {
    return p === "lg" ? { relayCode: key || undefined } : { apiKey: key || undefined };
  }
  function build(): AiSettingsSnapshot {
    return { provider: settings.provider, model: modelFor(settings.provider), baseUrl: settings.baseUrl, relayUrl: settings.relayUrl, persist, hasKey: key !== "", tasks: settings.tasks, storageWarning: warning };
  }
  function emit() {
    snapshot = build();
    listeners.forEach((l) => l());
  }
  function saveSettings() {
    if (!storages.local) return;
    const r = safe(() => storages.local!.setItem(SETTINGS_KEY, JSON.stringify(settings)));
    if (!r.ok) warning = "브라우저 저장소를 쓸 수 없어 설정을 기억하지 못합니다.";
  }
  function saveKey() {
    if (!storages.session) return;
    if (persist === "session" && key !== "") {
      const stored: StoredKey = { provider: settings.provider, baseUrl: bindingFor(settings.provider), key };
      const r = safe(() => storages.session!.setItem(SESSION_KEY, JSON.stringify(stored)));
      if (!r.ok) warning = "sessionStorage를 쓸 수 없어 키를 메모리에만 둡니다.";
    } else {
      safe(() => storages.session!.removeItem(SESSION_KEY));
    }
  }
  function dropKey() {
    key = "";
    if (storages.session) safe(() => storages.session!.removeItem(SESSION_KEY));
  }

  return {
    /** 마운트 후 한 번 부른다(정적 HTML hydration과 맞추기 위해) */
    hydrate() {
      if (storages.local) {
        const r = safe(() => storages.local!.getItem(SETTINGS_KEY));
        if (r.ok && r.value) {
          const parsed = safe(() => JSON.parse(r.value!) as Partial<StoredSettings>);
          if (parsed.ok && parsed.value && isProviderId(parsed.value.provider)) {
            settings = {
              provider: parsed.value.provider,
              models: typeof parsed.value.models === "object" && parsed.value.models ? parsed.value.models : {},
              baseUrl: typeof parsed.value.baseUrl === "string" ? parsed.value.baseUrl : "",
              relayUrl: typeof parsed.value.relayUrl === "string" ? parsed.value.relayUrl : "",
              tasks: parseTasks(parsed.value.tasks),
            };
          }
        }
      }
      if (storages.session) {
        const r = safe(() => storages.session!.getItem(SESSION_KEY));
        if (r.ok && r.value) {
          const parsed = safe(() => JSON.parse(r.value!) as Partial<StoredKey>);
          // 저장된 키가 지금 제공자·주소와 다르면 쓰지 않고 지운다
          if (parsed.ok && parsed.value && parsed.value.provider === settings.provider && parsed.value.baseUrl === bindingFor(settings.provider) && typeof parsed.value.key === "string") {
            key = parsed.value.key;
            persist = "session";
          } else {
            safe(() => storages.session!.removeItem(SESSION_KEY));
          }
        }
      }
      emit();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    /** 요청할 때만 키를 꺼낸다. 화면 상태에는 키를 두지 않는다 */
    getConfig(): ProviderConfig {
      return { provider: settings.provider, model: modelFor(settings.provider), baseUrl: baseUrlFor(settings.provider), ...credentialFor(settings.provider) };
    },
    /**
     * 작업에 쓸 설정. 작업 설정의 제공자가 공통 제공자와 다르면 AiError(unsupported)를 던진다
     * (키가 공통 제공자의 것이므로 다른 곳으로 보내지 않는다).
     */
    getConfigFor(task: AiTaskId): ProviderConfig {
      const t = settings.tasks[task];
      if (!t) return this.getConfig();
      if (t.provider === "mock") return { provider: "mock", model: MOCK_MODEL };
      if (t.provider !== settings.provider) {
        throw new AiError("unsupported", `이 작업은 ${CAPABILITIES[t.provider].label} 모델로 설정되어 있는데 공통 제공자는 ${CAPABILITIES[settings.provider].label}입니다. AI 설정의 작업별 모델을 고치세요.`);
      }
      return { provider: t.provider, model: t.model, baseUrl: baseUrlFor(t.provider), ...credentialFor(t.provider) };
    },
    /** null이면 공통 설정을 따른다 */
    setTaskSetting(task: AiTaskId, setting: TaskSetting | null) {
      const tasks = { ...settings.tasks };
      if (setting === null) delete tasks[task];
      else tasks[task] = setting.provider === "mock" ? { provider: "mock" } : { provider: setting.provider, model: setting.model.trim() };
      settings = { ...settings, tasks };
      saveSettings();
      emit();
    },
    setProvider(p: ProviderId) {
      if (p === settings.provider) return;
      settings = { ...settings, provider: p };
      dropKey();
      saveSettings();
      emit();
    },
    setModel(m: string) {
      settings = { ...settings, models: { ...settings.models, [settings.provider]: m.trim() } };
      saveSettings();
      emit();
    },
    setBaseUrl(u: string) {
      const next = u.trim();
      if (next === settings.baseUrl) return;
      settings = { ...settings, baseUrl: next };
      dropKey();
      saveSettings();
      emit();
    },
    /** 기본 AI 중계 주소. 주소를 바꾸면 이전 주소용 접속 코드는 지운다(다른 곳으로 같은 코드를 보내지 않게) */
    setRelayUrl(u: string) {
      const next = u.trim();
      if (next === settings.relayUrl) return;
      settings = { ...settings, relayUrl: next };
      dropKey();
      saveSettings();
      emit();
    },
    setKey(k: string) {
      key = k.trim();
      saveKey();
      emit();
    },
    setPersist(mode: KeyPersist) {
      persist = mode;
      saveKey();
      emit();
    },
    clearKey() {
      dropKey();
      emit();
    },
  };
}

export type AiSettingsStore = ReturnType<typeof createAiSettingsStore>;

let singleton: AiSettingsStore | null = null;
/** 브라우저 전역 저장소 하나. 페이지 이동(클라이언트 내비게이션) 사이에는 메모리 키가 유지된다 */
export function browserAiSettingsStore(): AiSettingsStore {
  if (!singleton) {
    const pick = (f: () => Storage) => {
      const r = safe(f);
      return r.ok ? r.value : null;
    };
    singleton = createAiSettingsStore({ local: pick(() => window.localStorage), session: pick(() => window.sessionStorage) }, defaultProviderFor(window.location.hostname));
    singleton.hydrate();
  }
  return singleton;
}
