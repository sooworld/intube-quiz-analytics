"use client";
// 서술형 퀴즈 화면 공통 상태: 데이터셋 + 채점 기록(이 브라우저 localStorage, 버전 검사).
// 키는 여기에 두지 않는다(src/lib/ai/keyStore.ts).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { applyGradeAction, emptyGrades, validateGradesState, type EssayGradesState, type GradeAction } from "../essay/grades";
import type { EssayQuizDataset } from "../types";
import { restoreDrafts, restoreSummaryFinal, type AiDraft, type StoredDrafts, type SummaryFinal } from "./aiRecords";
import { storageKey, useVersionedStorage, type StorageStatus } from "./storage";

interface EssayContextValue {
  ds: EssayQuizDataset;
  grades: EssayGradesState;
  status: StorageStatus;
  ready: boolean;
  /** 실패하면 GradeActionError를 던진다 */
  dispatch: (action: GradeAction) => void;
  resetAll: () => void;
  studentName: (attemptId: string) => string;
  /** 결과 요약 AI 초안 (docs/decisions.md §8.2, 불변·누적, 지금 데이터 버전만) */
  drafts: AiDraft[];
  /** 브라우저 저장소에 실제로 썼으면 true (false면 확정을 막는다) */
  addDraft: (d: AiDraft) => boolean;
  summaryFinal: SummaryFinal | null;
  saveSummaryFinal: (f: SummaryFinal) => boolean;
  clearSummaryFinal: () => void;
}

const Ctx = createContext<EssayContextValue | null>(null);

export function EssayProvider({ dataset, children }: { dataset: EssayQuizDataset; children: ReactNode }) {
  const fallback = useMemo(() => emptyGrades(dataset.dataVersion), [dataset.dataVersion]);
  const validate = useMemo(() => (raw: unknown) => validateGradesState(raw, dataset), [dataset]);
  const store = useVersionedStorage<EssayGradesState>(storageKey(dataset.quiz.id, "essay-grades"), validate, fallback);

  // 일괄 실행처럼 비동기로 여러 번 반영할 때 오래된 값 위에 덮어쓰지 않도록 최신 값을 ref에 둔다
  const latest = useRef(store.value);
  useEffect(() => {
    latest.current = store.value;
  }, [store.value]);
  const save = store.save;
  const dispatch = useCallback(
    (action: GradeAction) => {
      const next = applyGradeAction(latest.current, action);
      latest.current = next;
      save(next);
    },
    [save],
  );

  const validateDrafts = useMemo(() => (raw: unknown) => restoreDrafts(raw, dataset.dataVersion), [dataset.dataVersion]);
  const fallbackDrafts = useMemo<StoredDrafts>(() => ({ dataVersion: dataset.dataVersion, drafts: [], unreadable: [] }), [dataset.dataVersion]);
  const dr = useVersionedStorage<StoredDrafts>(storageKey(dataset.quiz.id, "ai-drafts"), validateDrafts, fallbackDrafts, { onInvalid: "keep" });
  const currentDrafts = useMemo(() => dr.value.drafts.filter((x) => x.dataVersion === dataset.dataVersion && x.quizId === dataset.quiz.id), [dr.value, dataset.dataVersion, dataset.quiz.id]);
  const validateS = useMemo(() => (raw: unknown) => restoreSummaryFinal(raw, dataset.dataVersion), [dataset.dataVersion]);
  const sf = useVersionedStorage<SummaryFinal | null>(storageKey(dataset.quiz.id, "summary"), validateS, null);

  const names = useMemo(() => {
    const byStudent = new Map(dataset.students.map((s) => [s.id, s.name]));
    return new Map(dataset.attempts.map((a) => [a.id, `${byStudent.get(a.studentId) ?? a.studentId}`]));
  }, [dataset]);

  const value: EssayContextValue = {
    ds: dataset,
    grades: store.value,
    status: store.status,
    ready: store.ready,
    dispatch,
    resetAll: () => {
      latest.current = fallback;
      store.clear();
    },
    studentName: (id) => names.get(id) ?? id,
    drafts: currentDrafts,
    addDraft: (draft) => dr.save({ ...dr.value, drafts: [...dr.value.drafts, draft] }),
    summaryFinal: sf.value,
    saveSummaryFinal: sf.save,
    clearSummaryFinal: sf.clear,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEssay(): EssayContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEssay는 EssayProvider 안에서만 쓸 수 있습니다");
  return v;
}
