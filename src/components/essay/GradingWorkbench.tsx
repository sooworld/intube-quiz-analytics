"use client";
// 서술형 채점 화면 (AI 우선 배치, 2026-11-11). 위: 문항 탭, AI 채점 진행(상태 막대·일괄 제안),
// 아래: 대기열 | 답안 | AI 제안·결정. 교수는 AI 제안을 수락·수정하거나 직접 채점한다(AI는 제안만, decisions §6.1 U2).
// 설명 문구는 제목 옆 ⓘ에 두고, 본문에는 상태가 바뀔 때의 안내만 보인다(decisions U13).
// 요청 문지기·캐시·일괄 정책·확정 규칙은 이전 배치와 같다.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AiWaitText } from "@/components/ai/AiRunStatus";
import { InfoTip } from "@/components/moodle/InfoTip";
import { runBatch, type BatchStop } from "@/lib/ai/batch";
import { blockReason, CAPABILITIES, errorHint, providerModelLabel } from "@/lib/ai/capabilities";
import { createRequestGate, requestSuggestion, suggestionInputHash } from "@/lib/ai/client";
import { browserAiSettingsStore } from "@/lib/ai/keyStore";
import { budgetedBatch, budgetLeft, fetchRunUsage, newRunId, runLabel, startClock, usageLabel } from "@/lib/ai/relayUsage";
import { AI_ERROR_TEXT, AiError, aiErrorText, isRetryable, type ProviderConfig, type StoredSuggestion } from "@/lib/ai/types";
import { useAiSettings } from "@/lib/ai/useAiSettings";
import { useRelayUsage } from "@/lib/ai/useRelayUsage";
import { formatSeconds, waitGuide } from "@/lib/ai/wait";
import { latestSuggestion, recordKey, type GradeAction } from "@/lib/essay/grades";
import { nextTarget, queueCounts, rowStatus, type QueueFilter } from "@/lib/essay/queue";
import { useEssay } from "@/lib/state/EssayContext";
import type { EssaySubmission } from "@/lib/types";
import { GradingQueue, QueueStatusBar, type QueueRow } from "./GradingQueue";
import { SubmissionPanel } from "./SubmissionPanel";

/** 제공자별 일괄 실행 상한과 간격. 무료 등급 분당 한도를 넘지 않게 Gemini는 간격을 넓힌다 */
function batchPolicy(provider: string) {
  if (provider === "mock") return { limit: Number.POSITIVE_INFINITY, intervalMs: 80 };
  if (provider === "gemini") return { limit: 10, intervalMs: 6500 };
  return { limit: 10, intervalMs: 1500 };
}

const BATCH_STOP_TEXT: Record<BatchStop, string> = {
  complete: "모두 처리했습니다.",
  limit: "한 번에 처리하는 상한(10건)에 도달했습니다. 다시 누르면 이어서 합니다.",
  "rate-limit": "사용 한도(429)에 걸려 멈췄습니다. 잠시 뒤 다시 누르면 멈춘 답안부터 이어서 합니다.",
  budget: "오늘 시연 예산을 다 써서 멈췄습니다. 처리하지 못한 답안은 그대로 남아 있습니다.",
  aborted: "취소했습니다.",
  error: "오류가 이어져 멈췄습니다. 설정을 확인하세요.",
};

type Focus = { key: string; target: "title" | "next" } | null;

export function GradingWorkbench() {
  const { ds, grades, ready, status, dispatch, studentName, resetAll } = useEssay();
  const ai = useAiSettings();
  const usage = useRelayUsage();
  const [itemId, setItemId] = useState(ds.quiz.items[0]!.id);
  const item = ds.quiz.items.find((i) => i.id === itemId)!;
  const subs = useMemo(() => ds.submissions.filter((s) => s.itemId === itemId), [ds, itemId]);
  const [selected, setSelected] = useState<string>(() => recordKey(subs[0]!.attemptId, itemId));
  // 선택은 필터와 무관하게 전체 제출에서 찾는다(필터에 걸려 숨겨져도 지금 답안을 유지)
  const sub = subs.find((s) => recordKey(s.attemptId, itemId) === selected) ?? subs[0]!;
  const key = recordKey(sub.attemptId, itemId);
  const [filter, setFilter] = useState<QueueFilter>("open");
  const [focus, setFocus] = useState<Focus>(null);

  const gate = useRef(createRequestGate());
  const single = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string; retryable: boolean } | null>(null);
  /** 마지막 개별 요청의 호출 수·소요 시간(기본 AI 중계일 때만) */
  const [runInfo, setRunInfo] = useState<{ key: string; text: string } | null>(null);

  const batchCtrl = useRef<AbortController | null>(null);
  const [batch, setBatch] = useState<{ running: boolean; current: string | null; done: number; failed: number; total: number; message: string | null; failures: string[]; calls: number | null }>({
    running: false,
    current: null,
    calls: null,
    done: 0,
    failed: 0,
    total: 0,
    message: null,
    failures: [],
  });
  const [confirmReset, setConfirmReset] = useState(false);

  // 화면을 떠나면 진행 중인 요청을 모두 취소한다(보이지 않는 곳에서 요청이 계속 나가지 않게)
  useEffect(() => {
    const g = gate.current;
    return () => {
      single.current?.abort();
      batchCtrl.current?.abort();
      g.invalidate();
    };
  }, []);

  const pageProtocol = typeof window === "undefined" ? "https:" : window.location.protocol;
  const cap = CAPABILITIES[ai.provider];
  const wait = waitGuide(ai.tasks["essay-grade"]?.provider ?? ai.provider, "essay-grade");

  /** 실행을 막는 이유(키 없음, https에서 로컬 중계, 작업별 설정 불일치). 키 자체는 화면 상태에 두지 않는다 */
  const configBlock = ((): string | null => {
    try {
      return blockReason(browserAiSettingsStore().getConfigFor("essay-grade"), pageProtocol)?.message ?? null;
    } catch (e) {
      return aiErrorText(e);
    }
  })();
  // 중계가 오늘 예산이 없다고 알려 주면 보내지 않는다(기본 AI일 때만 알 수 있음)
  const blockedText = configBlock ?? (ai.provider === "lg" && budgetLeft(usage) === 0 ? AI_ERROR_TEXT["relay-budget"] : null);

  /** 같은 입력(제공자·모델·프롬프트·루브릭·답안)의 유효 제안이 이미 있으면 다시 부르지 않는다 */
  const cachedFor = (s: EssaySubmission): StoredSuggestion | undefined => {
    let config;
    try {
      config = browserAiSettingsStore().getConfigFor("essay-grade");
    } catch {
      return undefined; // 작업별 설정이 공통 제공자와 맞지 않으면 실행할 때 오류를 보여 준다
    }
    const hash = suggestionInputHash(config, item, s.text);
    return grades.records[recordKey(s.attemptId, item.id)]?.suggestions.find((x) => x.inputHash === hash && x.result.status !== "invalid");
  };

  /** 문항·답안 이동. 이전 답안의 늦은 응답은 버린다 */
  const goTo = (nextItemId: string, nextKey: string) => {
    if (nextItemId === itemId && nextKey === selected) return;
    single.current?.abort();
    gate.current.invalidate();
    setPending(null);
    setError(null);
    setRunInfo(null);
    setFocus(null);
    setItemId(nextItemId);
    setSelected(nextKey);
  };

  const selectItem = (id: string) => {
    if (id === itemId) return;
    const first = ds.submissions.find((s) => s.itemId === id)!;
    goTo(id, recordKey(first.attemptId, id));
  };

  /**
   * 요청이 끝난 뒤 중계가 센 이 요청의 호출 수를 패널에 보인다(기본 AI 중계일 때만).
   * 오늘 예산은 fetchRunUsage가 갱신하는 상단 배지에 이미 보이므로 패널에 다시 쓰지 않는다(U13)
   */
  const reportRun = async (config: ProviderConfig, runId: string, ms: number, k: string, gateId: number) => {
    if (config.provider !== "lg") return;
    const u = await fetchRunUsage(config, runId);
    if (!gate.current.isCurrent(gateId)) return;
    setRunInfo({ key: k, text: runLabel(u?.runCalls ?? null, ms) });
  };

  const requestOne = async (force: boolean) => {
    if (!force && cachedFor(sub)) return; // 화면은 이미 그 제안을 보여 준다
    single.current?.abort();
    const ctrl = new AbortController();
    single.current = ctrl;
    const id = gate.current.next();
    const k = key;
    setPending(k);
    setError(null);
    setRunInfo(null);
    const runId = newRunId();
    const elapsed = startClock();
    let config: ProviderConfig | null = null;
    try {
      config = browserAiSettingsStore().getConfigFor("essay-grade");
      const s = await requestSuggestion({ config, item, essay: sub.text, signal: ctrl.signal, pageProtocol, runId });
      if (!gate.current.isCurrent(id)) return;
      dispatch({ type: "add-suggestion", key: k, suggestion: s });
      await reportRun(config, runId, elapsed(), k, id);
    } catch (e) {
      if (!gate.current.isCurrent(id)) return;
      if (e instanceof AiError && e.kind === "aborted") return;
      setError({ key: k, text: aiErrorText(e) + errorHint(ai.provider, e), retryable: isRetryable(e) });
      // 실패·시간 초과한 호출도 중계는 센다
      if (config) await reportRun(config, runId, elapsed(), k, id);
    } finally {
      if (gate.current.isCurrent(id)) setPending(null);
    }
  };

  const batchTargets = subs.filter((s) => !grades.records[recordKey(s.attemptId, item.id)]?.final && !cachedFor(s));
  const policy = batchPolicy(ai.provider);
  // 중계가 예산을 알려 주면 한 번에 보내는 답안 수를 남은 예산 이하로 줄이고 형식 오류 재시도를 끈다(재시도가 예산을 두 배로 쓰지 않게)
  const eff = budgetedBatch(policy.limit, usage);

  const startBatch = async () => {
    const ctrl = new AbortController();
    batchCtrl.current = ctrl;
    let config;
    try {
      config = browserAiSettingsStore().getConfigFor("essay-grade");
    } catch (e) {
      setBatch({ running: false, current: null, calls: null, done: 0, failed: 0, total: 0, message: aiErrorText(e), failures: [] });
      return;
    }
    const targetItem = item;
    const runId = newRunId();
    setBatch({ running: true, current: null, calls: null, done: 0, failed: 0, total: Math.min(eff.limit, batchTargets.length), message: null, failures: [] });
    const result = await runBatch({
      targets: batchTargets.map((s) => ({ key: recordKey(s.attemptId, targetItem.id), text: s.text })),
      limit: eff.limit,
      intervalMs: policy.intervalMs,
      signal: ctrl.signal,
      run: async (t, signal) => {
        setBatch((b) => ({ ...b, current: t.key }));
        const s = await requestSuggestion({ config, item: targetItem, essay: t.text, signal, pageProtocol, runId, retryFormat: eff.retryFormat });
        dispatch({ type: "add-suggestion", key: t.key, suggestion: s });
      },
      onProgress: (p) => setBatch((b) => ({ ...b, done: p.done, failed: p.failed, total: p.total })),
    });
    // 일괄 제안 전체가 한 실행이다: 중계가 센 총 호출 수(실패·재시도 포함)
    const u = await fetchRunUsage(config, runId);
    setBatch({
      running: false,
      current: null,
      calls: u?.runCalls ?? null,
      done: result.done.length,
      failed: result.failed.length,
      total: result.done.length + result.failed.length,
      message: BATCH_STOP_TEXT[result.stop],
      failures: result.failed.map((f) => `${studentName(f.key.split(":")[0]!)}: ${aiErrorText(f.error)}${errorHint(ai.provider, f.error)}`),
    });
  };

  if (!ready) return <p className="muted">채점 기록을 불러오는 중…</p>;

  const rows: QueueRow[] = subs.map((s) => {
    const k = recordKey(s.attemptId, itemId);
    const r = grades.records[k];
    const last = latestSuggestion(r);
    return {
      key: k,
      name: studentName(s.attemptId),
      status: rowStatus(r),
      empty: s.text === null,
      aiTotal: last && last.result.status !== "invalid" ? last.result.total : null,
      finalTotal: r?.final ? Object.values(r.final.levels).reduce<number>((a, b) => a + b, 0) : null,
      inProgress: batch.current === k,
    };
  });
  const counts = queueCounts(rows.map((r) => r.status));
  const finalCount = (id: string) => ds.submissions.filter((s) => s.itemId === id && grades.records[recordKey(s.attemptId, id)]?.final).length;
  const itemSize = (id: string) => ds.submissions.filter((s) => s.itemId === id).length;

  const order = ds.quiz.items.map((it) => ({ itemId: it.id, keys: ds.submissions.filter((s) => s.itemId === it.id).map((s) => recordKey(s.attemptId, it.id)) }));
  const next = nextTarget(order, { itemId, key }, (k) => !!grades.records[k]?.final);
  const nextItem = next ? ds.quiz.items.find((i) => i.id === next.itemId)! : null;

  const onAction = (a: GradeAction) => {
    dispatch(a); // 규칙 위반이면 GradeActionError를 던지고 패널이 보여 준다
    if (a.type === "finalize") setFocus({ key: a.key, target: "next" });
  };

  const rec = grades.records[key];
  const requestDisabled = blockedText !== null || batch.running;
  const providerText = ai.provider === "mock" ? cap.label : providerModelLabel(ai.provider, ai.model || "모델 미지정");

  return (
    <div className="stack gw">
      {status === "discarded" ? (
        <div className="alert alert-warning" role="status">
          <p>저장된 채점 기록이 손상되었거나 이전 데이터 버전이라 버렸습니다.</p>
        </div>
      ) : null}
      {status === "session-only" ? (
        <div className="alert alert-warning" role="status">
          <p>브라우저 저장소를 쓸 수 없어 채점 기록이 이번 세션에만 반영됩니다.</p>
        </div>
      ) : null}

      {/* 문항 탭이 맨 위에 있어 아래 카드들은 문항 번호를 다시 쓰지 않는다 */}
      <div className="tabs" role="tablist" aria-label="문항">
        {ds.quiz.items.map((it) => (
          <button key={it.id} type="button" role="tab" aria-selected={it.id === itemId} className={`tab-btn${it.id === itemId ? " active" : ""}`} onClick={() => selectItem(it.id)}>
            문항 {it.number}
            <span className="gw-tab-count">
              <span className="visually-hidden">확정 </span>
              {finalCount(it.id)}/{itemSize(it.id)}
            </span>
          </button>
        ))}
      </div>

      <section className="card gw-progress" aria-labelledby="gw-progress-title">
        <div className="gw-progress-head">
          <h2 className="card-title" id="gw-progress-title">
            AI 채점 진행
            <InfoTip label="일괄 제안">
              <span>
                확정하지 않았고 같은 설정의 제안이 없는 답안을 차례로 보냅니다
                {Number.isFinite(eff.limit) ? ` (한 번에 최대 ${eff.limit}건, 간격 ${(policy.intervalMs / 1000).toFixed(1)}초${eff.retryFormat ? "" : ", 오늘 예산을 아끼려 형식 오류 재시도 없음"})` : ""}.
              </span>
              {wait ? (
                <span>
                  AI는 답안 1건에 {wait.typicalSec ? `보통 약 ${formatSeconds(wait.typicalSec)} ` : ""}걸립니다. 최대 {formatSeconds(wait.limitSec)}까지 기다리고, 넘으면 &ldquo;다시 시도&rdquo;를 안내합니다.
                </span>
              ) : null}
              <span>
                채점 기록은 이 브라우저에만 저장됩니다.{ai.provider === "mock" ? " Mock은 규칙 기반 모의 채점이며 AI가 아닙니다." : " 가상 답안만 보냅니다."}
              </span>
            </InfoTip>
          </h2>
          <p className="small">
            {providerText}{" "}
            {cap.needsKey ? ai.hasKey ? <span className="badge badge-ok">키 있음</span> : <span className="badge badge-danger">키 없음</span> : null}{" "}
            {usageLabel(usage) ? <span className="badge">{usageLabel(usage)}</span> : null} <Link href="/settings/ai/">설정</Link>
          </p>
        </div>
        <div className="gw-progress-body">
          <div className="gw-progress-stats">
            <p>
              확정{" "}
              <strong>
                {counts.final}/{counts.all}
              </strong>
              {counts.attention ? <span className="badge badge-warn gw-attention">검토 필요 {counts.attention}</span> : null}
            </p>
            <QueueStatusBar counts={counts} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={batch.running || pending !== null || batchTargets.length === 0 || blockedText !== null} onClick={startBatch}>
              {batch.running
                ? `제안 받는 중 ${batch.done + batch.failed}/${batch.total}`
                : batchTargets.length === 0
                  ? "모든 답안에 제안이 있습니다"
                  : `AI 제안 받기 (${Number.isFinite(eff.limit) && batchTargets.length > eff.limit ? `${batchTargets.length}건 중 ${eff.limit}건` : `${batchTargets.length}건`})`}
            </button>
            {batch.running ? (
              <button type="button" className="btn btn-outline" onClick={() => batchCtrl.current?.abort()}>
                취소
              </button>
            ) : null}
          </div>
        </div>
        {blockedText ? (
          <p className="small text-danger" role="status">
            {blockedText} <Link href="/settings/ai/">AI 설정</Link>
          </p>
        ) : null}
        {batch.running ? <progress max={batch.total || 1} value={batch.done + batch.failed} aria-label="일괄 제안 진행률" /> : null}
        {batch.running ? (
          <p className="small muted" role="status">
            <AiWaitText key={batch.current ?? "start"} wait={wait} what={`답안 ${Math.min(batch.done + batch.failed + 1, batch.total)}/${batch.total}번째를 AI가 채점하는 중입니다.`} />
            {wait?.typicalSec ? ` 남은 시간은 대략 ${formatSeconds(wait.typicalSec * (batch.total - batch.done - batch.failed))}입니다.` : ""}
          </p>
        ) : null}
        {batch.message ? (
          <div role="status" className="small">
            <p>
              {batch.message} 성공 {batch.done}건{batch.failed ? `, 실패 ${batch.failed}건. 실패한 답안은 "AI 제안 받기"를 다시 누르면 이어서 시도합니다` : ""}.{batch.calls !== null ? ` 중계가 보낸 호출 총 ${batch.calls}회.` : ""}
            </p>
            {batch.failures.length ? (
              <ul>
                {batch.failures.slice(0, 5).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="gw-layout">
        <GradingQueue itemNumber={item.number} rows={rows} counts={counts} filter={filter} onFilter={setFilter} selectedKey={key} onSelect={(k) => goTo(itemId, k)} />
        <SubmissionPanel
          key={`${key}|${rec?.final?.decidedAt ?? ""}|${rec?.previousFinals?.length ?? 0}`}
          item={item}
          sub={sub}
          record={rec}
          studentName={studentName(sub.attemptId)}
          recordKey={key}
          pending={pending === key}
          error={error?.key === key ? error.text : null}
          errorRetryable={error?.key === key ? error.retryable : false}
          requestDisabled={requestDisabled}
          cached={!!cachedFor(sub)}
          runInfo={runInfo?.key === key ? runInfo.text : null}
          wait={wait}
          next={
            next && nextItem
              ? {
                  label: `${studentName(next.key.split(":")[0]!)}${next.itemId !== itemId ? ` · 문항 ${nextItem.number}` : ""}`,
                  go: () => {
                    goTo(next.itemId, next.key);
                    setFocus({ key: next.key, target: "title" });
                  },
                }
              : null
          }
          focusOnMount={focus?.key === key ? focus.target : null}
          onRequest={requestOne}
          onCancel={() => single.current?.abort()}
          onAction={onAction}
        />
      </div>

      <details className="card gw-reset">
        <summary>채점 기록 초기화</summary>
        <p className="card-sub">이 브라우저에 저장된 모든 제안과 확정을 지웁니다. 되돌릴 수 없습니다.</p>
        {confirmReset ? (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                resetAll();
                setConfirmReset(false);
              }}
            >
              정말 모두 지우기
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setConfirmReset(false)}>
              그만두기
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-outline" onClick={() => setConfirmReset(true)}>
            모든 채점 기록 지우기
          </button>
        )}
      </details>
    </div>
  );
}
