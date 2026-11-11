// AI 작업 실행의 진입점 (계획 T1). 제공자 선택, 실행 전 차단, 타임아웃·취소, 형식 오류 1회 재시도, 검증.
import type { EssayItem } from "../types";
import { blockReason } from "./capabilities";
import { hashString } from "./hash";
import { PROMPT_VERSION, SCHEMA_VERSION } from "./prompt";
import { anthropicGenerate } from "./providers/anthropic";
import { geminiGenerate } from "./providers/gemini";
import type { FetchLike } from "./providers/http";
import { lgGenerate } from "./providers/lg";
import { openaiGenerate } from "./providers/openai";
import { MOCK_MODEL, type AiTask, type GenerateRequest, type GenerateResult, type TokenUsage } from "./task";
import { essayGradeTask } from "./tasks/essayGrade";
import { AiError, type ProviderConfig, type ProviderId, type StoredSuggestion } from "./types";
import { emptySuggestion, VALIDATOR_VERSION } from "./validate";
import { timeoutMsFor } from "./wait";

export interface RunOptions {
  config: ProviderConfig;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  pageProtocol?: string;
  /** 형식 오류(JSON 아님)일 때 한 번 더 부를지. 실연 스크립트는 끈다 */
  retryFormat?: boolean;
  /** 실행 한 번을 가리키는 ID(기본 AI 중계의 호출 수 집계용) */
  runId?: string;
}

export interface TaskRun<V> {
  provider: ProviderId;
  requestedModel: string;
  responseModel: string | null;
  promptVersion: string;
  schemaVersion: string;
  validatorVersion: string;
  /** 실제로 제공자를 부른 횟수 (Mock은 0) */
  calls: number;
  /** 검증 전 모델 출력 (실연 기록·재생 테스트용). 키는 들어 있지 않다 */
  raw: unknown;
  /** 마지막 호출의 토큰 사용량 (실연 기록용). 모르면 null */
  usage: TokenUsage | null;
  result: V;
}

/** 바깥 취소 신호 + 타임아웃을 합친다 */
function withTimeout(outer: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(new AiError("aborted", "취소했습니다."));
  if (outer?.aborted) onAbort();
  outer?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new AiError("timeout", "응답 시간이 초과되었습니다.")), ms);
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

function generate(provider: Exclude<ProviderId, "mock">, req: GenerateRequest): Promise<GenerateResult> {
  switch (provider) {
    case "gemini":
      return geminiGenerate(req);
    case "anthropic":
      return anthropicGenerate(req);
    case "openai":
      return openaiGenerate(req);
    case "lg":
      return lgGenerate(req);
  }
}

/**
 * 작업 하나를 실행한다(일괄 요청 1건). 실패하면 AiError를 던진다.
 * 형식 오류만 한 번 더 부른다. 로컬 검증 결과(invalid·needs-review)는 다시 부르지 않고 그대로 돌려준다.
 */
export async function runTask<I, V>(task: AiTask<I, V>, input: I, opts: RunOptions): Promise<TaskRun<V>> {
  const { config } = opts;
  const meta = { promptVersion: task.promptVersion, schemaVersion: task.schemaVersion, validatorVersion: task.validatorVersion };
  if (config.provider === "mock") {
    if (opts.signal?.aborted) throw new AiError("aborted", "취소했습니다.");
    const raw = task.mock(input);
    return { provider: "mock", requestedModel: MOCK_MODEL, responseModel: MOCK_MODEL, ...meta, calls: 0, raw, usage: null, result: task.validate(raw, input) };
  }
  const blocked = blockReason(config, opts.pageProtocol);
  if (blocked) throw new AiError(blocked.kind, blocked.message);

  const provider = config.provider;
  const maxCalls = opts.retryFormat === false ? 1 : 2;
  let calls = 0;
  for (;;) {
    const t = withTimeout(opts.signal, opts.timeoutMs ?? timeoutMsFor(provider));
    calls++;
    try {
      const out = await generate(provider, {
        prompt: task.buildPrompt(input),
        schema: task.schema(input),
        schemaName: task.schemaName,
        maxTokens: task.maxTokens,
        model: config.model,
        apiKey: config.apiKey ?? "",
        baseUrl: config.baseUrl,
        relayCode: config.relayCode,
        runId: opts.runId,
        signal: t.signal,
        fetchImpl: opts.fetchImpl,
      });
      return { provider, requestedModel: config.model, responseModel: out.responseModel, ...meta, calls, raw: out.raw, usage: out.usage ?? null, result: task.validate(out.raw, input) };
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError("network", "알 수 없는 오류가 났습니다.");
      if (e.kind === "format" && calls < maxCalls && !opts.signal?.aborted) continue;
      throw e;
    } finally {
      t.done();
    }
  }
}

// ── 서술형 채점 제안 (저장 형식 StoredSuggestion은 §6 계약 그대로) ──

export interface SuggestOptions extends RunOptions {
  item: EssayItem;
  /** null이면 무응답 */
  essay: string | null;
  /** 테스트용 */
  now?: () => Date;
}

/** 문항·루브릭 내용 해시: 루브릭이 바뀌면 이전 제안과 구분된다 */
export function itemHash(item: EssayItem): string {
  return hashString(JSON.stringify({ stem: item.stem, context: item.context ?? "", rubric: item.rubric, charLimit: item.charLimit, maxScore: item.maxScore }));
}

/** 같은 입력이면 같은 값. 키는 넣지 않는다 */
export function suggestionInputHash(config: ProviderConfig, item: EssayItem, essay: string | null): string {
  return hashString(
    JSON.stringify([config.provider, config.model, config.provider === "openai" ? (config.baseUrl ?? "") : "", PROMPT_VERSION, SCHEMA_VERSION, itemHash(item), essay ?? null]),
  );
}

let counter = 0;
/** 기록 id. 시각 + 순번 + 난수 */
export function newId(prefix: string, now: Date): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}-${now.getTime().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * 제안 한 건을 만든다. 실패하면 AiError를 던진다.
 * 무응답은 키 검사·모델 호출 전에 모든 기준 0 제안을 만든다.
 */
export async function requestSuggestion(opts: SuggestOptions): Promise<StoredSuggestion> {
  const now = opts.now ?? (() => new Date());
  const { config, item, essay } = opts;
  const base = {
    provider: config.provider,
    model: config.provider === "mock" ? MOCK_MODEL : config.model,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    inputHash: suggestionInputHash(config, item, essay),
  };
  if (essay === null || essay.trim() === "") {
    const t = now();
    return { suggestionId: newId("sg", t), ...base, createdAt: t.toISOString(), result: emptySuggestion(item) };
  }
  const run = await runTask(essayGradeTask, { item, essay }, opts);
  const t = now();
  return { suggestionId: newId("sg", t), ...base, createdAt: t.toISOString(), result: run.result };
}

/**
 * 늦게 도착한 응답을 버리기 위한 요청 문지기. 네트워크 요청을 스스로 취소하지는 않으므로 AbortController와 함께 쓴다.
 * 새 요청을 시작하거나 다른 대상으로 옮기면 next()/invalidate()로 이전 요청을 무효로 만든다.
 */
export function createRequestGate() {
  let current = 0;
  return {
    next: () => ++current,
    invalidate: () => {
      current++;
    },
    isCurrent: (id: number) => id === current,
  };
}

// ── 앱 전체 동시 실행 1건 (docs/decisions.md §8.7) ──
let running: string | null = null;

/** 실행 권한을 얻으면 해제 함수를, 이미 다른 작업이 돌고 있으면 null을 돌려준다 */
export function acquireAiRun(label: string): (() => void) | null {
  if (running !== null) return null;
  running = label;
  return () => {
    if (running === label) running = null;
  };
}

export function currentAiRun(): string | null {
  return running;
}
