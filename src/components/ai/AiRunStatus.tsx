"use client";
// AI를 기다리는 동안의 안내(경과 시간·보통 걸리는 시간)와, 실패했을 때의 "다시 시도" 안내.
// 초안 카드 셋(태그·관계·요약)과 서술형 채점이 같은 문구를 쓰도록 한곳에 둔다.
import { useEffect, useState } from "react";
import { formatSeconds, type WaitGuide } from "@/lib/ai/wait";

/** 마운트된 뒤 지난 초를 센다. 기다리는 동안에만 마운트하면 요청마다 0에서 시작한다 */
function useElapsedSeconds(): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return sec;
}

/** 대기 중 한 줄. 경과 시간은 보조기기가 매초 읽지 않도록 숨기고, 고정 문장만 알린다 */
export function AiWaitText({ wait, what = "AI가 작성 중입니다." }: { wait: WaitGuide | null; what?: string }) {
  const elapsed = useElapsedSeconds();
  if (!wait) return <>{what}</>;
  const slow = wait.typicalSec !== null && wait.typicalSec > 0 && elapsed > wait.typicalSec * 1.5;
  return (
    <>
      {what}{" "}
      {wait.typicalSec ? `보통 약 ${formatSeconds(wait.typicalSec)} 걸리고, ` : ""}
      최대 {formatSeconds(wait.limitSec)}까지 기다립니다.{" "}
      <span aria-hidden="true">
        {formatSeconds(elapsed)} 경과{slow ? " · 평소보다 오래 걸리고 있습니다" : ""}
      </span>
    </>
  );
}

/** 오류 문장과, 다시 보내면 풀릴 수 있는 오류에는 "다시 시도" 버튼 */
export function AiErrorNote({ error, retryable, onRetry, disabled = false }: { error: string; retryable: boolean; onRetry: () => void; disabled?: boolean }) {
  return (
    <div className="alert alert-warning" role="alert">
      <p>{error}</p>
      {retryable ? (
        <p className="btn-row">
          <button type="button" className="btn btn-sm btn-primary" onClick={onRetry} disabled={disabled}>
            다시 시도
          </button>
          <span className="small">입력한 내용과 이전 결과는 그대로 있습니다.</span>
        </p>
      ) : null}
    </div>
  );
}

/** 초안 카드용: 대기 안내 줄 + 오류 알림 */
export function AiRunStatus({
  busy,
  wait,
  error,
  retryable,
  idleMessage,
  runInfo = null,
  onRetry,
}: {
  busy: boolean;
  wait: WaitGuide | null;
  error: string | null;
  retryable: boolean;
  idleMessage: string | null;
  /** 마지막 실행의 호출 수·소요 시간·오늘 예산(기본 AI 중계일 때만) */
  runInfo?: string | null;
  onRetry: () => void;
}) {
  return (
    <>
      <p role="status" aria-live="polite" className="small">
        {busy ? <AiWaitText wait={wait} /> : idleMessage}
      </p>
      {!busy && runInfo ? <p className="small muted">{runInfo}</p> : null}
      {error ? <AiErrorNote error={error} retryable={retryable} onRetry={onRetry} /> : null}
    </>
  );
}
