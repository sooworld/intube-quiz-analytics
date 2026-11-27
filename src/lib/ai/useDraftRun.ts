"use client";
// AI 초안 실행 훅 (docs/decisions.md §8.7). 작업별 설정 → 앱 전체 동시 1건 → 실행 → 불변 초안 저장.
// 설정이 바뀌거나 화면을 떠나면 요청을 취소하고, 늦은 응답은 버린다.
import { useEffect, useRef, useState } from "react";
import { providerModelLabel } from "./capabilities";
import { acquireAiRun, createRequestGate, currentAiRun, newId, runTask } from "./client";
import { browserAiSettingsStore, type AiSettingsSnapshot } from "./keyStore";
import { AI_TASK_LABEL, type AiTask, type AiTaskId } from "./task";
import { aiErrorText, AiError, isRetryable, type SuggestionStatus } from "./types";
import { useAiSettings } from "./useAiSettings";
import { waitGuide } from "./wait";
import type { AiDraft, DraftTaskId } from "../state/aiRecords";

export interface DraftRunState {
  busy: boolean;
  error: string | null;
  /** 오류가 같은 요청을 다시 보내면 풀릴 수 있는 종류인지(시간 초과·서버·네트워크 등) */
  retryable: boolean;
  /** 초안을 받았지만 브라우저 저장소에 쓰지 못했을 때 (반영을 막는다) */
  unsaved: boolean;
  /** 나눠 부를 때 진행 (묶음 done/total) */
  progress?: { done: number; total: number };
}

/** 초안을 어느 퀴즈의 저장소에 쌓을지 (객관식은 QuizContext, 서술형은 EssayContext) */
export interface DraftTarget {
  quizId: string;
  dataVersion: string;
  /** 브라우저 저장소에 실제로 썼으면 true */
  addDraft: (d: AiDraft) => boolean;
}

/**
 * 실제 모델에서 입력이 커서 한 번에 보내면 잘리거나 시간을 넘길 때, 입력을 나눠 차례로 부르고 결과를 합쳐 초안 하나로 저장한다.
 * Mock은 나누지 않는다. 한 묶음이라도 실패하면 전체를 실패로 둔다(부분 결과를 저장하지 않음).
 */
export interface DraftSplit<I, V> {
  split: (input: I) => I[];
  merge: (parts: V[]) => V;
}

/** 이 작업이 Mock(규칙 기반)으로 실행되는지 (getConfigFor와 같은 규칙). Mock은 프롬프트를 쓰지 않으므로 화면은 v1 객체로 실행해야 한다.
 *  runTask는 Mock에도 task의 promptVersion을 기록해, v2 객체로 돌리면 Mock 초안이 상세를 쓴 것처럼 보인다(계획 반례 5) */
export function taskUsesMock(ai: Pick<AiSettingsSnapshot, "provider" | "tasks">, taskId: AiTaskId): boolean {
  const t = ai.tasks[taskId];
  return t ? t.provider === "mock" : ai.provider === "mock";
}

export function useDraftRun<I, V extends { status: SuggestionStatus }>(task: AiTask<I, V> & { id: DraftTaskId }, target: DraftTarget, splitter?: DraftSplit<I, V>) {
  const { quizId, dataVersion, addDraft } = target;
  const ai = useAiSettings();
  const [state, setState] = useState<DraftRunState>({ busy: false, error: null, retryable: false, unsaved: false });
  const ctrl = useRef<AbortController | null>(null);
  const gate = useRef(createRequestGate());
  /** 나눠 부를 때 이미 끝난 묶음 결과 (같은 입력·설정에서만 다시 쓴다. 저장소에는 넣지 않고, 다 끝나야 초안 하나로 저장) */
  const partial = useRef<{ key: string; done: Map<number, V> } | null>(null);
  const taskSetting = JSON.stringify(ai.tasks[task.id] ?? null);

  // 설정이 바뀌면 진행 중인 요청을 취소한다
  useEffect(() => {
    ctrl.current?.abort();
    gate.current.invalidate();
  }, [ai.provider, ai.model, ai.baseUrl, taskSetting]);
  // 화면을 떠나면 취소한다
  useEffect(() => () => ctrl.current?.abort(), []);

  const usesMock = taskUsesMock(ai, task.id);

  const run = async (input: I, basisHash: string): Promise<AiDraft<I, V> | null> => {
    let config;
    try {
      config = browserAiSettingsStore().getConfigFor(task.id);
    } catch (e) {
      setState({ busy: false, error: aiErrorText(e), retryable: false, unsaved: false });
      return null;
    }
    // 화면이 본 설정(Mock 여부)과 실행 시점 설정이 다르면 보내지 않는다. 화면은 Mock 여부로 v1/v2 입력을 고른다
    if ((config.provider === "mock") !== usesMock) {
      setState({ busy: false, error: "AI 설정이 바뀌었습니다. 화면을 확인한 뒤 다시 실행하세요.", retryable: false, unsaved: false });
      return null;
    }
    const release = acquireAiRun(task.id);
    if (!release) {
      const other = currentAiRun();
      setState({ busy: false, error: `다른 AI 작업(${other && other in AI_TASK_LABEL ? AI_TASK_LABEL[other as keyof typeof AI_TASK_LABEL] : "진행 중"})이 끝난 뒤에 실행하세요.`, retryable: false, unsaved: false });
      return null;
    }
    const c = new AbortController();
    ctrl.current = c;
    const id = gate.current.next();
    setState({ busy: true, error: null, retryable: false, unsaved: false });
    try {
      const pageProtocol = typeof window === "undefined" ? "https:" : window.location.protocol;
      const opts = { config, signal: c.signal, pageProtocol };
      let r = await (async () => {
        if (!splitter || config.provider === "mock") return runTask(task, input, opts);
        const parts = splitter.split(input);
        const key = JSON.stringify([basisHash, config.provider, config.model, config.baseUrl ?? ""]);
        if (partial.current?.key !== key) partial.current = { key, done: new Map() };
        const done = partial.current.done;
        let last: Awaited<ReturnType<typeof runTask<I, V>>> | null = null;
        let calls = 0;
        for (const [k, part] of parts.entries()) {
          if (done.has(k)) continue;
          setState({ busy: true, error: null, retryable: false, unsaved: false, progress: { done: done.size, total: parts.length } });
          last = await runTask(task, part, opts);
          calls += last.calls;
          if (!gate.current.isCurrent(id)) return last;
          done.set(k, last.result);
        }
        const results = parts.map((_, k) => done.get(k)!);
        partial.current = null;
        // 모든 묶음이 보존본이면 응답 메타가 없으므로 설정 값으로 채운다(다시 부르지 않음)
        const meta = last ?? { provider: config.provider as Exclude<typeof config.provider, "mock">, requestedModel: config.model, responseModel: null, promptVersion: task.promptVersion, schemaVersion: task.schemaVersion, validatorVersion: task.validatorVersion, calls: 0, raw: null, usage: null, result: results[0]! };
        return { ...meta, calls, raw: null, result: splitter.merge(results) };
      })();
      if (!gate.current.isCurrent(id)) return null;
      r = r!;
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
      setState({ busy: false, error: null, retryable: false, unsaved: !saved });
      return draft;
    } catch (e) {
      if (!gate.current.isCurrent(id)) return null;
      const aborted = e instanceof AiError && e.kind === "aborted";
      const kept = partial.current?.done.size ?? 0;
      const note = kept > 0 ? ` 끝난 글 묶음 ${kept}개는 이 화면에 보존했습니다. 다시 실행하면 남은 묶음만 보냅니다(완료 전에는 집계에 넣지 않음).` : "";
      setState({ busy: false, error: aborted ? null : `${aiErrorText(e)}${note}`, retryable: isRetryable(e) || kept > 0, unsaved: false });
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

  const wait = waitGuide(t?.provider ?? ai.provider, task.timeoutMs);

  return { ...state, run, cancel, modelLabel, wait, taskUsesMock: usesMock };
}
