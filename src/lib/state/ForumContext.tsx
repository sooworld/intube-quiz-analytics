"use client";
// 토론 화면 공통 상태: 데이터셋 + 교수 기록 + AI 초안 (이 브라우저 localStorage, 버전 검사).
// 도구 결과(초안)는 불변·누적이고, 교수 기록(체크표·예상·배정 확정·첨언 표시)은 따로 저장한다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ForumDesignResult } from "../ai/tasks/forumDesign";
import type { ForumCommentResult } from "../ai/tasks/forumComment";
import type { ForumProfileResult } from "../ai/tasks/forumProfile";
import {
  emptyAssignments,
  emptyChecklist,
  restoreAssignments,
  restoreChecklist,
  restoreCommentMarks,
  restoreExpectation,
  type CommentMarks,
  type Expectation,
  type TeacherAssignments,
  type TeacherChecklist,
} from "../forum/state";
import type { ForumDataset } from "../forum/types";
import { restoreDrafts, type AiDraft, type StoredDrafts } from "./aiRecords";
import { storageKey, useVersionedStorage, type StorageStatus } from "./storage";

interface ForumContextValue {
  ds: ForumDataset;
  ready: boolean;
  checklist: TeacherChecklist;
  saveChecklist: (c: TeacherChecklist) => boolean;
  checklistStatus: StorageStatus;
  expectation: Expectation | null;
  saveExpectation: (e: Expectation | null) => boolean;
  assignments: TeacherAssignments;
  /** 최신 값 위에 바꾼다(빠르게 여러 번 눌러도 덮어쓰지 않게) */
  updateAssignments: (f: (s: TeacherAssignments) => TeacherAssignments) => boolean;
  commentMarks: CommentMarks;
  saveCommentMarks: (m: CommentMarks) => boolean;
  drafts: AiDraft[];
  addDraft: (d: AiDraft) => boolean;
  latestDesign: AiDraft<unknown, ForumDesignResult> | null;
  latestProfile: AiDraft<unknown, ForumProfileResult> | null;
  latestComment: AiDraft<unknown, ForumCommentResult> | null;
  /** 형식 오류(invalid)까지 포함한 마지막 실행. 쓸 수 있는 초안과 다르면 화면이 알린다 (Codex 구현 검토 8) */
  latestDesignAttempt: AiDraft<unknown, ForumDesignResult> | null;
  latestProfileAttempt: AiDraft<unknown, ForumProfileResult> | null;
  latestCommentAttempt: AiDraft<unknown, ForumCommentResult> | null;
  /** 교수 기록이나 초안을 브라우저에 쓰지 못해 이번 세션에만 있는 상태 (Codex 구현 검토 9) */
  sessionOnly: boolean;
  /** 이 토론의 교수 기록을 모두 지운다(AI 초안은 근거 기록이라 남긴다) */
  resetTeacher: () => void;
}

const Ctx = createContext<ForumContextValue | null>(null);

function latest<T>(drafts: AiDraft[], task: string, includeInvalid = false): T | null {
  const xs = drafts.filter((d) => d.task === task && (includeInvalid || d.result.status !== "invalid"));
  return (xs[xs.length - 1] as unknown as T) ?? null;
}

export function ForumProvider({ dataset, children }: { dataset: ForumDataset; children: ReactNode }) {
  const id = dataset.forum.id;
  const v = dataset.dataVersion;

  const cl = useVersionedStorage<TeacherChecklist>(
    storageKey(id, "forum-checklist"),
    useMemo(() => (raw: unknown) => restoreChecklist(raw, dataset), [dataset]),
    useMemo(() => emptyChecklist(v), [v]),
  );
  const ex = useVersionedStorage<Expectation | null>(
    storageKey(id, "forum-expectation"),
    useMemo(() => (raw: unknown) => restoreExpectation(raw, dataset), [dataset]),
    null,
  );
  const as = useVersionedStorage<TeacherAssignments>(
    storageKey(id, "forum-assignments"),
    useMemo(() => (raw: unknown) => restoreAssignments(raw, dataset), [dataset]),
    useMemo(() => emptyAssignments(v), [v]),
    { onInvalid: "keep" },
  );
  const cm = useVersionedStorage<CommentMarks>(
    storageKey(id, "forum-comment-marks"),
    useMemo(() => (raw: unknown) => restoreCommentMarks(raw, dataset), [dataset]),
    useMemo(() => ({ dataVersion: v, byDraft: {} }), [v]),
  );
  const dr = useVersionedStorage<StoredDrafts>(
    storageKey(id, "ai-drafts"),
    useMemo(() => (raw: unknown) => restoreDrafts(raw, v), [v]),
    useMemo(() => ({ dataVersion: v, drafts: [], unreadable: [] }), [v]),
    { onInvalid: "keep" },
  );

  const latestAs = useRef(as.value);
  useEffect(() => {
    latestAs.current = as.value;
  }, [as.value]);
  const saveAs = as.save;
  const updateAssignments = useCallback(
    (f: (s: TeacherAssignments) => TeacherAssignments) => {
      const next = f(latestAs.current);
      latestAs.current = next;
      return saveAs(next);
    },
    [saveAs],
  );

  const latestDr = useRef(dr.value);
  useEffect(() => {
    latestDr.current = dr.value;
  }, [dr.value]);
  const saveDr = dr.save;
  const addDraft = useCallback(
    (d: AiDraft) => {
      const next = { ...latestDr.current, drafts: [...latestDr.current.drafts, d] };
      latestDr.current = next;
      return saveDr(next);
    },
    [saveDr],
  );

  const drafts = useMemo(() => dr.value.drafts.filter((d) => d.dataVersion === v && d.quizId === id), [dr.value, v, id]);

  const value: ForumContextValue = {
    ds: dataset,
    ready: cl.ready && ex.ready && as.ready && cm.ready && dr.ready,
    checklist: cl.value,
    saveChecklist: cl.save,
    checklistStatus: cl.status,
    expectation: ex.value,
    saveExpectation: ex.save,
    assignments: as.value,
    updateAssignments,
    commentMarks: cm.value,
    saveCommentMarks: cm.save,
    drafts,
    addDraft,
    latestDesign: latest(drafts, "forum-design"),
    latestProfile: latest(drafts, "forum-profile"),
    latestComment: latest(drafts, "forum-comment"),
    latestDesignAttempt: latest(drafts, "forum-design", true),
    latestProfileAttempt: latest(drafts, "forum-profile", true),
    latestCommentAttempt: latest(drafts, "forum-comment", true),
    sessionOnly: [cl.status, ex.status, as.status, cm.status, dr.status].includes("session-only"),
    resetTeacher: () => {
      cl.clear();
      ex.clear();
      latestAs.current = emptyAssignments(v);
      as.clear();
      cm.clear();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useForum(): ForumContextValue {
  const x = useContext(Ctx);
  if (!x) throw new Error("useForum은 ForumProvider 안에서만 쓸 수 있습니다");
  return x;
}
