"use client";
// AI 초안 실행 훅 (docs/decisions.md §8.7). 작업별 설정 → 앱 전체 동시 1건 → 실행 → 불변 초안 저장.
// 설정이 바뀌거나 화면을 떠나면 요청을 취소하고, 늦은 응답은 버린다.
// 기본 AI(중계)로 돌린 실행은 중계가 센 "호출 n회 · 소요 s초"와 오늘 예산을 runInfo로 알린다(저장하지 않는다).
import { useEffect, useRef, useState } from "react";
import { errorHint, providerModelLabel } from "./capabilities";
import { acquireAiRun, createRequestGate, currentAiRun, newId, runTask } from "./client";
import { browserAiSettingsStore } from "./keyStore";
import { budgetLeft, fetchRunUsage, newRunId, relayUsageStore, runLabel, usageLabel } from "./relayUsage";
import { AI_TASK_LABEL, type AiTask } from "./task";
import { AI_ERROR_TEXT, aiErrorText, AiError, isRetryable, type ProviderConfig, type SuggestionStatus } from "./types";
import { useAiSettings } from "./useAiSettings";
import { useRelayUsage } from "./useRelayUsage";
import { waitGuide } from "./wait";
import type { AiDraft, DraftTaskId } from "../state/aiRecords";

export interface DraftRunState {
  busy: boolean;
  error: string | null;
  /** 오류가 같은 요청을 다시 보내면 풀릴 수 있는 종류인지(시간 초과·서버·네트워크 등) */
  retryable: boolean;
  /** 초안을 받았지만 브라우저 저장소에 쓰지 못했을 때 (반영을 막는다) */
  unsaved: boolean;
  /** 마지막 실행의 호출 수·소요 시간·오늘 예산(기본 AI 중계일 때만) */
  runInfo: string | null;
}

/** 초안을 어느 퀴즈의 저장소에 쌓을지 (객관식은 QuizContext, 서술형은 EssayContext) */
export interface DraftTarget {
  quizId: string;
  dataVersion: string;
  /** 브라우저 저장소에 실제로 썼으면 true */
  addDraft: (d: AiDraft) => boolean;
}

/** 실행이 끝난 뒤 중계에서 이 실행의 호출 수와 오늘 사용량을 읽어 한 줄로 만든다 */
async function describeRun(config: ProviderConfig, runId: string, ms: number): Promise<string | null> {
  if (config.provider !== "lg") return null;
  const u = await fetchRunUsage(config, runId);
  return [runLabel(u?.runCalls ?? null, ms), usageLabel(u)].filter(Boolean).join(" · ");
}

export function useDraftRun<I, V extends { status: SuggestionStatus }>(task: AiTask<I, V> & { id: DraftTaskId }, target: DraftTarget) {
  const { quizId, dataVersion, addDraft } = target;
  const ai = useAiSettings();
  useRelayUsage(); // 오늘 예산을 미리 읽어 두면 예산이 없을 때 호출하기 전에 막을 수 있다
  const [state, setState] = useState<DraftRunState>({ busy: false, error: null, retryable: false, unsaved: false, runInfo: null });
  const ctrl = useRef<AbortController | null>(null);
  const gate = useRef(createRequestGate());
  const taskSetting = JSON.stringify(ai.tasks[task.id] ?? null);

  // 설정이 바뀌면 진행 중인 요청을 취소한다
  useEffect(() => {
    ctrl.current?.abort();
    gate.current.invalidate();
  }, [ai.provider, ai.model, ai.baseUrl, ai.relayUrl, taskSetting]);
  // 화면을 떠나면 취소한다
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (input: I, basisHash: string): Promise<AiDraft<I, V> | null> => {
    let config;
    try {
      config = browserAiSettingsStore().getConfigFor(task.id);
    } catch (e) {
      setState({ busy: false, error: aiErrorText(e), retryable: false, unsaved: false, runInfo: null });
      return null;
    }
    // 중계가 오늘 예산이 없다고 알려 주면 보내지 않는다(보내도 중계가 막지만 불필요한 대기를 없앤다)
    if (config.provider === "lg" && budgetLeft(relayUsageStore.get()) === 0) {
      setState({ busy: false, error: AI_ERROR_TEXT["relay-budget"], retryable: false, unsaved: false, runInfo: null });
      return null;
    }
    const release = acquireAiRun(task.id);
    if (!release) {
      const other = currentAiRun();
      setState({ busy: false, error: `다른 AI 작업(${other && other in AI_TASK_LABEL ? AI_TASK_LABEL[other as keyof typeof AI_TASK_LABEL] : "진행 중"})이 끝난 뒤에 실행하세요.`, retryable: false, unsaved: false, runInfo: null });
      return null;
    }
    const c = new AbortController();
    ctrl.current = c;
    const id = gate.current.next();
    const runId = newRunId();
    const started = Date.now();
    setState({ busy: true, error: null, retryable: false, unsaved: false, runInfo: null });
    try {
      const pageProtocol = typeof window === "undefined" ? "https:" : window.location.protocol;
      const r = await runTask(task, input, { config, signal: c.signal, pageProtocol, runId });
      if (!gate.current.isCurrent(id)) return null;
      const now = new Date();
      const draft: AiDraft<I, V> = {
        draftId: newId("dr", now),
        task: task.id,
        quizId,
        dataVersion,
        provider: r.provider,
        requestedModel: r.requestedModel,
        responseModel: r.responseModel,
        promptVersion: r.promptVersion,
        schemaVersion: r.schemaVersion,
        validatorVersion: r.validatorVersion,
        basisHash,
        input,
        createdAt: now.toISOString(),
        result: r.result,
      };
      const saved = addDraft(draft as unknown as AiDraft);
      const runInfo = await describeRun(config, runId, Date.now() - started);
      setState({ busy: false, error: null, retryable: false, unsaved: !saved, runInfo });
      return draft;
    } catch (e) {
      if (!gate.current.isCurrent(id)) return null;
      const aborted = e instanceof AiError && e.kind === "aborted";
      // 실패·시간 초과한 호출도 중계는 세므로 호출 수를 보여 준다. 취소는 보여 줄 결과가 없다
      const runInfo = aborted ? null : await describeRun(config, runId, Date.now() - started);
      setState({ busy: false, error: aborted ? null : aiErrorText(e) + errorHint(config.provider, e), retryable: isRetryable(e), unsaved: false, runInfo });
      return null;
    } finally {
      release();
      if (gate.current.isCurrent(id)) setState((s) => (s.busy ? { ...s, busy: false } : s));
    }
  };

  const cancel = () => {
    ctrl.current?.abort();
  };

  /** 패널에 보여 줄 선택 모델 */
  // 스냅숏으로 계산한다(정적 HTML·hydration과 맞추기 위해 저장소를 렌더 중에 직접 읽지 않는다)
  const t = ai.tasks[task.id];
  const modelLabel = !t
    ? ai.provider === "mock"
      ? "Mock (규칙 기반, AI 아님)"
      : providerModelLabel(ai.provider, ai.model)
    : t.provider === "mock"
      ? "Mock (규칙 기반, AI 아님)"
      : t.provider !== ai.provider
        ? "설정 오류 (AI 설정의 작업별 모델 확인)"
        : providerModelLabel(t.provider, t.model);

  const wait = waitGuide(t?.provider ?? ai.provider, task.id);

  return { ...state, run, cancel, modelLabel, wait };
}
