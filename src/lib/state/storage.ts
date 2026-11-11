"use client";
// 버전이 있는 로컬 저장 (T5).
// - 마운트 후에 복원하고, 복원이 끝나기 전에는 쓰지 않는다 (기존 편집을 기본값으로 덮어쓰지 않기 위해)
// - 구조가 맞지 않거나 데이터 버전이 다른 값은 버리고 알린다
// - 저장이 실패하면 화면은 유지하고 "이번 세션에만 반영됨"으로 표시한다
import { useCallback, useEffect, useRef, useState } from "react";

export const STORAGE_PREFIX = "qa-demo:v1";

export type StorageStatus =
  | "restoring" // 아직 복원 전
  | "empty" // 저장된 값 없음
  | "restored" // 저장된 값을 불러옴
  | "discarded" // 저장된 값이 손상되었거나 구버전이라 버림
  | "session-only"; // 브라우저 저장소를 쓸 수 없어 이번 세션에만 반영

export function storageKey(quizId: string, kind: string): string {
  return `${STORAGE_PREFIX}:${quizId}:${kind}`;
}

function safeGet(key: string): { ok: true; value: string | null } | { ok: false } {
  try {
    return { ok: true, value: window.localStorage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

function safeSet(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export interface StorageOptions {
  /**
   * 복원 검증에 실패했을 때: discard(기본) = 지운다. keep = 원문을 "<key>:unreadable:<시각>"에 옮겨 보존한다
   * (AI 초안처럼 근거 기록이라 지우면 안 되는 저장소용, docs/decisions.md §8.2)
   */
  onInvalid?: "discard" | "keep";
}

export function useVersionedStorage<T>(key: string, validate: (raw: unknown) => T | null, fallback: T, options: StorageOptions = {}) {
  const [value, setValue] = useState<T>(fallback);
  const [status, setStatus] = useState<StorageStatus>("restoring");
  const restored = useRef(false);

  // 외부 저장소(localStorage)를 마운트 시점에 한 번 읽어 React 상태로 옮긴다.
  // 정적 HTML과 hydration 결과를 맞추려면 렌더 중이 아니라 마운트 후에 읽어야 한다.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const got = safeGet(key);
    if (!got.ok) {
      setStatus("session-only");
    } else if (got.value === null) {
      setStatus("empty");
    } else {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(got.value);
      } catch {
        parsed = null;
      }
      const valid = validate(parsed);
      if (valid === null) {
        if (options.onInvalid === "keep") safeSet(`${key}:unreadable:${Date.now()}`, got.value);
        safeSet(key, null);
        setStatus("discarded");
      } else {
        setValue(valid);
        setStatus("restored");
      }
    }
    restored.current = true;
    // key가 바뀔 때만 다시 복원한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const save = useCallback(
    /** 브라우저 저장소에 실제로 썼으면 true (복원 전이거나 저장소를 쓸 수 없으면 false) */
    (next: T): boolean => {
      setValue(next);
      if (!restored.current) return false; // 복원 전에는 쓰지 않는다
      const ok = safeSet(key, JSON.stringify(next));
      setStatus(ok ? "restored" : "session-only");
      return ok;
    },
    [key],
  );

  const clear = useCallback(() => {
    setValue(fallback);
    if (!restored.current) return;
    const ok = safeSet(key, null);
    setStatus(ok ? "empty" : "session-only");
  }, [key, fallback]);

  return { value, save, clear, status, ready: status !== "restoring" };
}
