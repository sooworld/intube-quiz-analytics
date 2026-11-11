"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { buildMatrix, defaultQMatrix, hashQMatrix, type ResponseMatrix } from "../analysis/matrix";
import type { Concept, Item, QMatrix, QuizDataset, Student, StudentId } from "../types";
import {
  defaultProvenance,
  restoreDrafts,
  restoreProvenance,
  restoreRelations,
  restoreSummaryFinal,
  snapshotsCurrent,
  type AiDraft,
  type ConfirmedRelation,
  type QProvenance,
  type RelationSnapshot,
  type StoredDrafts,
  type StoredRelations,
  type SummaryFinal,
} from "./aiRecords";
import { storageKey, useVersionedStorage, type StorageStatus } from "./storage";

export interface SavedGroup {
  name: string;
  studentIds: StudentId[];
  /** 알고리즘 결과 그대로인지, 교수가 수정했는지 */
  source: "algorithm" | "edited";
  conceptId?: string;
  /** 개념 묶음 그룹 (docs/decisions.md §8.5): 각 개념 보충 그룹의 합집합 */
  bundle?: { conceptIds: string[]; rule: "union"; threshold: number; relations: RelationSnapshot[] };
}

export interface GroupDecision {
  dataVersion: string;
  qmatrixHash: string;
  savedAt: string;
  status: "saved" | "deferred" | "rejected";
  mode: "concept" | "cluster" | "density" | "bundle" | "none";
  settings: { threshold?: number; k?: number; eps?: number; minPts?: number };
  reason?: string;
  groups: SavedGroup[];
}

interface StoredQMatrix {
  dataVersion: string;
  qmatrix: QMatrix;
  /** 문항별 태그 출처 (docs/decisions.md §8.2). 없으면 모두 default */
  provenance: QProvenance;
}

interface QuizContextValue {
  ds: QuizDataset;
  m: ResponseMatrix;
  concepts: Concept[];
  itemById: Map<string, Item>;
  studentById: Map<string, Student>;
  conceptById: Map<string, Concept>;
  defaultQ: QMatrix;
  qmatrix: QMatrix;
  qmatrixHash: string;
  isDefaultQ: boolean;
  qStatus: StorageStatus;
  qReady: boolean;
  /** 문항별 출처: AI 초안 반영 기록 */
  qprovenance: QProvenance;
  saveQMatrix: (q: QMatrix, provenance: QProvenance) => void;
  resetQMatrix: () => void;
  decision: GroupDecision | null;
  dStatus: StorageStatus;
  dReady: boolean;
  saveDecision: (d: GroupDecision) => void;
  clearDecision: () => void;
  /** 저장된 그룹안의 입력(데이터·Q-matrix·묶음이 쓴 관계)이 지금과 다르면 true */
  decisionStale: boolean;
  /** 교수가 확정한 개념 관계 */
  relations: ConfirmedRelation[];
  relStatus: StorageStatus;
  relReady: boolean;
  saveRelations: (r: ConfirmedRelation[]) => boolean;
  /** 지금 데이터 버전의 AI 초안 (불변·누적, 오래된 것부터) */
  drafts: AiDraft[];
  draftsReady: boolean;
  /** 읽을 수 없어 보존만 하는 기록 수 */
  unreadableDrafts: number;
  /** 초안을 추가한다. 브라우저 저장소에 실제로 썼으면 true (false면 반영을 막는다) */
  addDraft: (d: AiDraft) => boolean;
  summaryFinal: SummaryFinal | null;
  saveSummaryFinal: (f: SummaryFinal) => boolean;
  clearSummaryFinal: () => void;
}

const Ctx = createContext<QuizContextValue | null>(null);

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

export function QuizProvider({ dataset, children }: { dataset: QuizDataset; children: ReactNode }) {
  const m = useMemo(() => buildMatrix(dataset), [dataset]);
  const concepts = dataset.quiz.concepts;
  const defaultQ = useMemo(() => defaultQMatrix(dataset.quiz.items), [dataset]);
  const itemIds = useMemo(() => new Set(dataset.quiz.items.map((i) => i.id)), [dataset]);
  const conceptIds = useMemo(() => new Set(concepts.map((c) => c.id)), [concepts]);
  const studentIds = useMemo(() => new Set(dataset.students.map((s) => s.id)), [dataset]);

  const validateQ = useMemo(
    () =>
      (raw: unknown): StoredQMatrix | null => {
        if (!raw || typeof raw !== "object") return null;
        const r = raw as Partial<StoredQMatrix>;
        if (r.dataVersion !== dataset.dataVersion || !r.qmatrix || typeof r.qmatrix !== "object") return null;
        const q: QMatrix = {};
        for (const id of itemIds) {
          const tags = (r.qmatrix as Record<string, unknown>)[id];
          if (!isStringArray(tags) || !tags.every((t) => conceptIds.has(t))) return null;
          q[id] = [...new Set(tags)];
        }
        const provenance = restoreProvenance((r as { provenance?: unknown }).provenance, itemIds);
        if (!provenance) return null;
        return { dataVersion: dataset.dataVersion, qmatrix: q, provenance };
      },
    [dataset.dataVersion, itemIds, conceptIds],
  );

  const validateD = useMemo(
    () =>
      (raw: unknown): GroupDecision | null => {
        if (!raw || typeof raw !== "object") return null;
        const d = raw as Partial<GroupDecision>;
        if (d.dataVersion !== dataset.dataVersion) return null;
        if (typeof d.qmatrixHash !== "string" || typeof d.savedAt !== "string") return null;
        if (!["saved", "deferred", "rejected"].includes(d.status as string)) return null;
        if (!["concept", "cluster", "density", "bundle", "none"].includes(d.mode as string)) return null;
        if (!Array.isArray(d.groups)) return null;
        for (const g of d.groups) {
          if (!g || typeof g.name !== "string" || !isStringArray(g.studentIds)) return null;
          if (!g.studentIds.every((s) => studentIds.has(s))) return null;
          if (g.source !== "algorithm" && g.source !== "edited") return null;
          if (g.bundle !== undefined && (!Array.isArray(g.bundle.conceptIds) || !Array.isArray(g.bundle.relations) || typeof g.bundle.threshold !== "number")) return null;
        }
        return d as GroupDecision;
      },
    [dataset.dataVersion, studentIds],
  );

  const fallbackQ = useMemo<StoredQMatrix>(() => ({ dataVersion: dataset.dataVersion, qmatrix: defaultQ, provenance: defaultProvenance(itemIds) }), [dataset.dataVersion, defaultQ, itemIds]);
  const q = useVersionedStorage<StoredQMatrix>(storageKey(dataset.quiz.id, "qmatrix"), validateQ, fallbackQ);
  const d = useVersionedStorage<GroupDecision | null>(storageKey(dataset.quiz.id, "groups"), validateD, null);

  const validateR = useMemo(() => (raw: unknown) => restoreRelations(raw, dataset.dataVersion, conceptIds, itemIds), [dataset.dataVersion, conceptIds, itemIds]);
  const fallbackR = useMemo<StoredRelations>(() => ({ dataVersion: dataset.dataVersion, relations: [] }), [dataset.dataVersion]);
  const rel = useVersionedStorage<StoredRelations>(storageKey(dataset.quiz.id, "relations"), validateR, fallbackR);

  const validateDrafts = useMemo(() => (raw: unknown) => restoreDrafts(raw, dataset.dataVersion), [dataset.dataVersion]);
  const fallbackDrafts = useMemo<StoredDrafts>(() => ({ dataVersion: dataset.dataVersion, drafts: [], unreadable: [] }), [dataset.dataVersion]);
  const dr = useVersionedStorage<StoredDrafts>(storageKey(dataset.quiz.id, "ai-drafts"), validateDrafts, fallbackDrafts, { onInvalid: "keep" });

  const validateS = useMemo(() => (raw: unknown) => restoreSummaryFinal(raw, dataset.dataVersion), [dataset.dataVersion]);
  const sf = useVersionedStorage<SummaryFinal | null>(storageKey(dataset.quiz.id, "summary"), validateS, null);

  const currentDrafts = useMemo(() => dr.value.drafts.filter((x) => x.dataVersion === dataset.dataVersion && x.quizId === dataset.quiz.id), [dr.value, dataset.dataVersion, dataset.quiz.id]);
  const bundleStale = !!d.value && d.value.groups.some((g) => g.bundle && !snapshotsCurrent(g.bundle.relations, rel.value.relations));

  const qmatrix = q.value.qmatrix;
  const qmatrixHash = useMemo(() => hashQMatrix(qmatrix), [qmatrix]);
  const defaultHash = useMemo(() => hashQMatrix(defaultQ), [defaultQ]);

  const value: QuizContextValue = {
    ds: dataset,
    m,
    concepts,
    itemById: useMemo(() => new Map(dataset.quiz.items.map((i) => [i.id, i])), [dataset]),
    studentById: useMemo(() => new Map(dataset.students.map((s) => [s.id, s])), [dataset]),
    conceptById: useMemo(() => new Map(concepts.map((c) => [c.id, c])), [concepts]),
    defaultQ,
    qmatrix,
    qmatrixHash,
    isDefaultQ: qmatrixHash === defaultHash,
    qStatus: q.status,
    qReady: q.ready,
    qprovenance: q.value.provenance,
    saveQMatrix: (next, provenance) => q.save({ dataVersion: dataset.dataVersion, qmatrix: next, provenance }),
    resetQMatrix: q.clear,
    decision: d.value,
    dStatus: d.status,
    dReady: d.ready,
    saveDecision: d.save,
    clearDecision: d.clear,
    decisionStale: !!d.value && (d.value.qmatrixHash !== qmatrixHash || d.value.dataVersion !== dataset.dataVersion || bundleStale),
    relations: rel.value.relations,
    relStatus: rel.status,
    relReady: rel.ready,
    saveRelations: (relations) => rel.save({ dataVersion: dataset.dataVersion, relations }),
    drafts: currentDrafts,
    draftsReady: dr.ready,
    unreadableDrafts: dr.value.unreadable.length,
    addDraft: (draft) => dr.save({ ...dr.value, drafts: [...dr.value.drafts, draft] }),
    summaryFinal: sf.value,
    saveSummaryFinal: sf.save,
    clearSummaryFinal: sf.clear,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQuiz(): QuizContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQuiz는 QuizProvider 안에서만 쓸 수 있습니다");
  return v;
}
