// 토론 분석의 계산 부분 (b0-prereg.md §6 분석 설정 고정). 거리는 "어휘 연관도·후보"로만 쓴다(품질·요구 판정 금지, SB2).
import { CharTfidf, sparseCosine, type SparseVec } from "./tfidf";
import { stripQuoted } from "./text";
import { cellKey, type AssignmentTarget, type CellJudgment, type CellKey, type ForumDataset } from "./types";

/** "공통" 열 id (안내 글의 공통 제출 요건) */
export const COMMON = "common";

// ── TF-IDF 말뭉치 (§6: 목표 + Q 문장 + 주제 + 안내 글 + 원본 글) ──

export interface ForumVectors {
  model: CharTfidf;
  objective: Map<string, SparseVec>;
  /** Q 문서 = Q 문장 + 주제 문장 */
  question: Map<string, SparseVec>;
  intro: SparseVec;
  post: Map<string, SparseVec>;
}

export function qDocument(ds: ForumDataset, qId: string): string {
  const q = ds.subQuestions.find((x) => x.id === qId);
  return `${q?.text ?? ""} ${ds.forum.topic}`;
}

export function fitForum(ds: ForumDataset, postText: (id: string, text: string) => string = (_, t) => t): ForumVectors {
  const docs = [
    ...ds.objectives.map((o) => o.text),
    ...ds.subQuestions.map((q) => q.text),
    ds.forum.topic,
    ds.forum.intro,
    ...ds.posts.map((p) => postText(p.id, p.text)),
  ];
  const model = new CharTfidf(2, 4, "max").fit(docs);
  return {
    model,
    objective: new Map(ds.objectives.map((o) => [o.id, model.transform(o.text)])),
    question: new Map(ds.subQuestions.map((q) => [q.id, model.transform(qDocument(ds, q.id))])),
    intro: model.transform(ds.forum.intro),
    post: new Map(ds.posts.map((p) => [p.id, model.transform(postText(p.id, p.text))])),
  };
}

// ── 설계 지도: 어휘 연관도 (S1) ──

export interface LexicalCell {
  objectiveId: string;
  /** Q id 또는 COMMON */
  target: string;
  cosine: number;
}

export interface LexicalDesignMap {
  cells: LexicalCell[];
  /** 목표별 Q 칸 최대값 */
  maxByObjective: Record<string, number>;
  /** 전체 O×Q 칸의 하위 25% 경계 (탐색용 휴리스틱, S1) */
  q1Threshold: number;
  /** 최대값이 하위 25% 이하인 목표 (탐색용. 설계 공백 판정이 아님) */
  lowObjectives: string[];
}

/** 정렬된 배열의 분위수 (선형 보간, numpy 기본값과 같음) */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function lexicalDesignMap(ds: ForumDataset, v: ForumVectors = fitForum(ds)): LexicalDesignMap {
  const cells: LexicalCell[] = [];
  for (const o of ds.objectives) {
    const ov = v.objective.get(o.id)!;
    for (const q of ds.subQuestions) cells.push({ objectiveId: o.id, target: q.id, cosine: sparseCosine(ov, v.question.get(q.id)!) });
    cells.push({ objectiveId: o.id, target: COMMON, cosine: sparseCosine(ov, v.intro) });
  }
  const qCells = cells.filter((c) => c.target !== COMMON);
  const maxByObjective: Record<string, number> = {};
  for (const c of qCells) maxByObjective[c.objectiveId] = Math.max(maxByObjective[c.objectiveId] ?? 0, c.cosine);
  const q1Threshold = quantile(
    qCells.map((c) => c.cosine).sort((a, b) => a - b),
    0.25,
  );
  const lowObjectives = ds.objectives.map((o) => o.id).filter((id) => (maxByObjective[id] ?? 0) <= q1Threshold);
  return { cells, maxByObjective, q1Threshold, lowObjectives };
}

// ── 설계 지도: 계획서 문장 포함 어휘 연관도 (docs/decisions.md U19) ──
// 목표 문장에 계획서 상세를 이어 붙이지 않는다. 이어 붙이면 길어진 문서가 정규화로 희석돼 값이 오히려 내려간다
// (2026-11-27 실측: f5 20칸 중 11칸 하락). 대신 목표 문장과 상세의 문장들을 각각 재어 가장 가까운 문장을 고른다.
// 모델(v)은 사전 등록 말뭉치로 적합한 그대로 쓴다. 그래서 Q·안내 글 벡터는 B2와 같고, 값은 B2 이상이다.
// 요구 판정이 아니며(S1), 계획서를 활동에서 거꾸로 만들었으므로 높게 나온 값은 근거가 아니다.

export interface SyllabusCell extends LexicalCell {
  /** 목표 문장만 쓴 값 (사전 등록 B2 설정) */
  sentenceCosine: number;
  /** 최댓값을 낸 문장. -1 = 목표 문장, 0 이상 = 계획서 상세의 그 번째 문장 */
  sourceIndex: number;
  sourceText: string;
}

export function syllabusDesignMap(ds: ForumDataset, detailSentences: Record<string, string[]>, v: ForumVectors = fitForum(ds)): SyllabusCell[] {
  const targets: [string, SparseVec][] = [...ds.subQuestions.map((q) => [q.id, v.question.get(q.id)!] as [string, SparseVec]), [COMMON, v.intro]];
  const cells: SyllabusCell[] = [];
  for (const o of ds.objectives) {
    const ov = v.objective.get(o.id)!;
    const sents = (detailSentences[o.id] ?? []).map((s) => [s, v.model.transform(s)] as const);
    for (const [target, tv] of targets) {
      const sentenceCosine = sparseCosine(ov, tv);
      let best = { cosine: sentenceCosine, sourceIndex: -1, sourceText: o.text };
      sents.forEach(([s, sv], i) => {
        const c = sparseCosine(sv, tv);
        if (c > best.cosine) best = { cosine: c, sourceIndex: i, sourceText: s };
      });
      cells.push({ objectiveId: o.id, target, sentenceCosine, ...best });
    }
  }
  return cells;
}

// ── 설계 지도: 필수 판정에서 공백 찾기 (T3) ──

/** 칸이 없으면 "미검토"(교수 체크표) 또는 "미확정"(도구 판정이 검토 필요). 무관은 "none"으로 따로 적는다 (Codex 구현 검토 6) */
export type Checklist = Partial<Record<CellKey, CellJudgment>>;

export type CellState = CellJudgment | "unset";

export interface DesignGaps {
  /** 모든 열을 판정했고, 어떤 Q도 공통 요건도 필수로 요구하지 않는 목표 */
  uncoveredObjectives: string[];
  /** 모든 목표를 판정했고, 어떤 목표와도(필수·선택) 이어지지 않는 Q */
  unlinkedQuestions: string[];
  /** 필수 칸이 없지만 아직 판정하지 않은 칸이 있어 공백인지 모르는 목표 */
  pendingObjectives: string[];
  /** 이어진 목표가 없지만 아직 판정하지 않은 칸이 있어 모르는 Q */
  pendingQuestions: string[];
}

/** 화면 표시용: 미검토도 무관처럼 읽어야 할 때만 쓴다 */
export function judgmentOf(cl: Checklist, objectiveId: string, target: string): CellJudgment {
  return cl[cellKey(objectiveId, target)] ?? "none";
}

export function cellState(cl: Checklist, objectiveId: string, target: string): CellState {
  return cl[cellKey(objectiveId, target)] ?? "unset";
}

/** 공통 요건 열을 체크표 형식으로 */
export function commonAsChecklist(ds: ForumDataset): Checklist {
  const out: Checklist = {};
  for (const [oid, j] of Object.entries(ds.commonRequirements)) if (j) out[cellKey(oid, COMMON)] = j;
  return out;
}

export function designGaps(ds: ForumDataset, cl: Checklist): DesignGaps {
  const targets = [...ds.subQuestions.map((q) => q.id), COMMON];
  const out: DesignGaps = { uncoveredObjectives: [], unlinkedQuestions: [], pendingObjectives: [], pendingQuestions: [] };
  for (const o of ds.objectives) {
    const s = targets.map((t) => cellState(cl, o.id, t));
    if (s.includes("required")) continue;
    (s.includes("unset") ? out.pendingObjectives : out.uncoveredObjectives).push(o.id);
  }
  for (const q of ds.subQuestions) {
    const s = ds.objectives.map((o) => cellState(cl, o.id, q.id));
    if (s.some((x) => x === "required" || x === "optional")) continue;
    (s.includes("unset") ? out.pendingQuestions : out.unlinkedQuestions).push(q.id);
  }
  return out;
}

/** 모든 칸을 판정했는지 */
export function isComplete(ds: ForumDataset, cl: Checklist): boolean {
  return ds.objectives.every((o) => [...ds.subQuestions.map((q) => q.id), COMMON].every((t) => cellState(cl, o.id, t) !== "unset"));
}

export interface CellDiff {
  objectiveId: string;
  target: string;
  a: CellState;
  b: CellState;
}

export function diffChecklists(ds: ForumDataset, a: Checklist, b: Checklist): CellDiff[] {
  const out: CellDiff[] = [];
  for (const o of ds.objectives)
    for (const t of [...ds.subQuestions.map((q) => q.id), COMMON]) {
      const ja = cellState(a, o.id, t);
      const jb = cellState(b, o.id, t);
      if (ja !== jb) out.push({ objectiveId: o.id, target: t, a: ja, b: jb });
    }
  return out;
}

// ── 논의 지도: 어휘 후보 (S2) ──

export interface Candidate {
  qId: string;
  cosine: number;
}

/** 글마다 Q 문서와의 코사인 내림차순 (동점은 Q id 순). 영벡터면 빈 배열(§6) */
export function lexicalCandidates(ds: ForumDataset, v: ForumVectors = fitForum(ds)): Record<string, Candidate[]> {
  const out: Record<string, Candidate[]> = {};
  for (const p of ds.posts) {
    const pv = v.post.get(p.id)!;
    if (pv.size === 0) {
      out[p.id] = [];
      continue;
    }
    out[p.id] = ds.subQuestions
      .map((q) => ({ qId: q.id, cosine: sparseCosine(pv, v.question.get(q.id)!) }))
      .sort((a, b) => b.cosine - a.cosine || a.qId.localeCompare(b.qId));
  }
  return out;
}

// ── 논의 지도: 집계 (T4, T8) ──

export interface PostAssignment {
  postId: string;
  primary: AssignmentTarget;
  secondary: string[];
}

export interface QuestionCount {
  qId: string;
  primaryPosts: number;
  primaryAuthors: number;
  /** 주 배정 + 부 배정 */
  anyPosts: number;
  anyAuthors: number;
}

export interface DiscussionAggregate {
  totalPosts: number;
  totalAuthors: number;
  replies: number;
  /** 답글 묶음(스레드) 수: 과제에 바로 단 글 하나가 한 스레드 */
  threads: number;
  questions: QuestionCount[];
  special: Record<"new" | "off" | "hold", { posts: number; authors: number }>;
  /** 배정 결과가 없는 글 (아직 분석 전이거나 결과 누락) */
  unassigned: number;
}

export function aggregate(ds: ForumDataset, assignments: PostAssignment[]): DiscussionAggregate {
  const authorOf = new Map(ds.posts.map((p) => [p.id, p.author]));
  const byPost = new Map(assignments.map((a) => [a.postId, a]));
  const questions = ds.subQuestions.map((q) => {
    const prim = assignments.filter((a) => a.primary === q.id);
    const any = assignments.filter((a) => a.primary === q.id || a.secondary.includes(q.id));
    return {
      qId: q.id,
      primaryPosts: prim.length,
      primaryAuthors: new Set(prim.map((a) => authorOf.get(a.postId))).size,
      anyPosts: any.length,
      anyAuthors: new Set(any.map((a) => authorOf.get(a.postId))).size,
    };
  });
  const sp = (t: "new" | "off" | "hold") => {
    const xs = assignments.filter((a) => a.primary === t);
    return { posts: xs.length, authors: new Set(xs.map((a) => authorOf.get(a.postId))).size };
  };
  return {
    totalPosts: ds.posts.length,
    totalAuthors: new Set(ds.posts.map((p) => p.author)).size,
    replies: ds.posts.filter((p) => p.parentId !== null).length,
    threads: ds.posts.filter((p) => p.parentId === null).length,
    questions,
    special: { new: sp("new"), off: sp("off"), hold: sp("hold") },
    unassigned: ds.posts.filter((p) => !byPost.has(p.id)).length,
  };
}

// ── 표현 중복 후보 (S4) ──

export interface PairScore {
  a: string;
  b: string;
  cosine: number;
}

/**
 * 모든 글 쌍의 코사인. stripQuotes면 큰따옴표 안과 작품 행을 지우고 잰다(T6).
 * IDF는 두 조건 모두 원본 말뭉치로 학습한 것을 쓴다(b0-prereg §6). 그래야 전후 차이가 인용 제거의 효과만 된다(Codex 구현 검토 11).
 */
export function pairScores(ds: ForumDataset, opts: { stripQuotes: boolean }): PairScore[] {
  const v = fitForum(ds);
  const vec = new Map(ds.posts.map((p) => [p.id, opts.stripQuotes ? v.model.transform(stripQuoted(p.text, ds.work)) : v.post.get(p.id)!]));
  const out: PairScore[] = [];
  for (let i = 0; i < ds.posts.length; i++)
    for (let j = i + 1; j < ds.posts.length; j++) {
      const a = ds.posts[i]!.id;
      const b = ds.posts[j]!.id;
      out.push({ a, b, cosine: sparseCosine(vec.get(a)!, vec.get(b)!) });
    }
  return out.sort((x, y) => y.cosine - x.cosine);
}

/** 화면 기본값: 인용 제거 후 τ=0.5 (b0-prereg.md S4, 잠정값) */
export const OVERLAP_THRESHOLD = 0.5;

export function overlapCandidates(ds: ForumDataset, threshold = OVERLAP_THRESHOLD): PairScore[] {
  return pairScores(ds, { stripQuotes: true }).filter((p) => p.cosine >= threshold);
}

/** 답글마다 부모 글과의 표현 중복 (인용 제거 후 코사인). 부모가 없으면 null */
export function parentOverlaps(ds: ForumDataset): Record<string, number | null> {
  const key = (a: string, b: string) => [a, b].sort().join("~");
  const m = new Map(pairScores(ds, { stripQuotes: true }).map((p) => [key(p.a, p.b), p.cosine]));
  return Object.fromEntries(ds.posts.map((p) => [p.id, p.parentId === null ? null : (m.get(key(p.id, p.parentId)) ?? null)]));
}
