// 시연용 가상 데이터 생성기 (T9). 시드를 고정해 항상 같은 JSON을 만든다.
// 실행: npm run gen:data  →  src/data/course.json, quiz-w5.json(정의), roster.json,
//                            public/xapi/quiz-w5.statements.json(응답 원천), quiz-w5.validation.json
//
// 주의: 학생 프로필을 미리 심어 두었으므로, 분석 화면에서 이 패턴이 다시 보이는 것은
// "생성 가정의 재현"일 뿐 분석의 교육적 타당성을 입증하지 않는다.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gradeItem } from "../src/lib/analysis/grading";
import type { Course, Item, QuizDataset, Response } from "../src/lib/types";
import { toQuizDataset } from "../src/lib/xapi/toDataset";
import { STATEMENT_DATA_VERSION } from "../src/lib/xapi/vocab";
import { buildCohort, PROFILE_STRENGTH, rng, SEED, type Profile } from "./shared/cohort";
import { quizStatements } from "./shared/xapiStatements";
import { SPEC_BASIS, VALIDATOR, validateStatements } from "./shared/xapiValidate";

const DATA_VERSION = "2026-11-11.1";
const TIME_SEED = 20261110;

const rand = rng(SEED);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
function weightedPick<T>(entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1]![0];
}

const concepts = [
  { id: "c-hyp", name: "시간복잡도", description: "Big-O 표기, 최선·평균·최악의 경우, 증가율의 의미" },
  { id: "c-reg", name: "정렬·탐색", description: "퀵·병합 정렬의 동작과 안정성, 해시·이진 탐색" },
  { id: "c-clu", name: "그래프 탐색", description: "DFS·BFS의 자료구조와 방문 표시" },
  { id: "c-dist", name: "최단 경로", description: "BFS·다익스트라의 적용 조건, 경로 비용 계산" },
];

const items: Item[] = [
  {
    id: "q1", number: 1, type: "mcq", conceptIds: ["c-hyp"],
    stem: "알고리즘의 시간복잡도가 O(n²)이라는 표기의 의미로 가장 적절한 것은?",
    options: [
      { id: "A", text: "입력 크기 n이 2배가 되면 실행 시간이 정확히 4배가 된다", misconception: "Big-O를 정확한 실행 시간 공식으로 해석" },
      { id: "B", text: "n이 충분히 클 때 연산 횟수의 증가율이 n²을 넘지 않는다(점근적 상한)" },
      { id: "C", text: "실행 시간이 항상 n²밀리초이다", misconception: "Big-O를 실제 시간 단위로 해석" },
      { id: "D", text: "최선의 경우에도 n²번의 연산이 필요하다", misconception: "Big-O(상한)와 최선 경우·하한 혼동" },
    ],
    correctOptionId: "B",
  },
  {
    id: "q2", number: 2, type: "mcq", conceptIds: ["c-reg"],
    stem: "같은 키를 가진 원소들의 원래 순서가 정렬 후에도 유지되는 안정 정렬(stable sort)은?",
    options: [
      { id: "A", text: "퀵 정렬", misconception: "평균 속도가 빠르면 안정적이라고 오해" },
      { id: "B", text: "병합 정렬" },
      { id: "C", text: "선택 정렬", misconception: "단순한 정렬은 안정적이라고 오해" },
      { id: "D", text: "힙 정렬", misconception: "O(n log n) 정렬은 모두 안정적이라고 오해" },
    ],
    correctOptionId: "B",
  },
  {
    id: "q3", number: 3, type: "mcq", conceptIds: ["c-hyp"],
    stem: "해시 테이블에서 키로 값을 찾는 연산의 평균 시간복잡도는?",
    options: [
      { id: "A", text: "O(n)", misconception: "모든 키가 충돌한다고 가정(평균과 최악 혼동)" },
      { id: "B", text: "O(1)" },
      { id: "C", text: "O(log n)", misconception: "이진 탐색과 혼동" },
      { id: "D", text: "O(n log n)", misconception: "정렬 비용과 혼동" },
    ],
    correctOptionId: "B",
  },
  {
    id: "q4", number: 4, type: "mcq", conceptIds: ["c-reg"],
    stem: "퀵 정렬에서 pivot(피벗)의 역할로 옳은 것은?",
    options: [
      { id: "A", text: "pivot보다 작은 원소는 왼쪽, 큰 원소는 오른쪽으로 나누는 기준값이다" },
      { id: "B", text: "pivot은 항상 배열의 중앙값이어야 한다", misconception: "pivot을 중앙값으로 오해" },
      { id: "C", text: "pivot은 정렬이 끝난 뒤 마지막에 고르는 값이다", misconception: "pivot의 선택 시점을 오해" },
      { id: "D", text: "pivot은 정렬 결과를 저장하는 보조 배열이다", misconception: "pivot과 병합 정렬의 보조 배열 혼동" },
    ],
    correctOptionId: "A",
  },
  {
    id: "q5", number: 5, type: "mcq", conceptIds: ["c-reg", "c-hyp"],
    stem: "병합 정렬의 최악 시간복잡도로 옳은 것은?",
    options: [
      { id: "A", text: "O(n log n)" },
      { id: "B", text: "O(n²)", misconception: "버블·삽입 정렬과 혼동" },
      { id: "C", text: "O(n)", misconception: "한 번 순회로 정렬된다고 오해" },
      { id: "D", text: "O(log n)", misconception: "이진 탐색과 혼동" },
    ],
    correctOptionId: "A",
  },
  {
    id: "q6", number: 6, type: "mcq", conceptIds: ["c-clu"],
    stem: "그래프를 DFS(깊이 우선 탐색)로 순회할 때 일반적으로 사용하는 자료구조는?",
    options: [
      { id: "A", text: "큐(queue)", misconception: "BFS의 자료구조와 혼동" },
      { id: "B", text: "스택(stack) 또는 재귀 호출" },
      { id: "C", text: "우선순위 큐(priority queue)", misconception: "다익스트라의 자료구조와 혼동" },
      { id: "D", text: "해시 테이블", misconception: "방문 표시용 집합과 탐색 자료구조 혼동" },
    ],
    correctOptionId: "B",
  },
  {
    id: "q7", number: 7, type: "mcq", conceptIds: ["c-clu"],
    stem: "그래프 탐색에서 무한 루프를 막으려면 이미 방문한 정점을 기록해 두어야 한다. 이 기록을 가리키는 용어는?",
    options: [
      { id: "A", text: "피벗(pivot)", misconception: "퀵 정렬 개념과 혼동" },
      { id: "B", text: "스택 프레임", misconception: "재귀 호출 개념과 혼동" },
      { id: "C", text: "방문 표시(visited 집합)" },
      { id: "D", text: "힙(heap)", misconception: "우선순위 큐 개념과 혼동" },
    ],
    correctOptionId: "C",
  },
  {
    id: "q8", number: 8, type: "mcq", conceptIds: ["c-dist"],
    stem: "간선 가중치가 모두 양수인 그래프에서 한 정점으로부터 다른 모든 정점까지의 최단 거리를 구하는 알고리즘은?",
    options: [
      { id: "A", text: "DFS(깊이 우선 탐색)", misconception: "경로 탐색과 최단 경로 혼동" },
      { id: "B", text: "다익스트라(Dijkstra) 알고리즘" },
      { id: "C", text: "프림(Prim) 알고리즘", misconception: "최소 신장 트리와 최단 경로 혼동" },
      { id: "D", text: "위상 정렬", misconception: "DAG 순서화와 최단 경로 혼동" },
    ],
    correctOptionId: "B",
  },
  {
    id: "q9", number: 9, type: "short", conceptIds: ["c-dist"],
    stem: "간선이 A→B(2), B→C(3), A→C(6), C→D(1)인 가중치 그래프에서 A에서 D까지의 최단 경로 비용을 숫자로 쓰시오.",
    shortAnswer: {
      policy: "numeric",
      accepted: ["6"],
      tolerance: 0.01,
      misconceptionRules: [
        { equals: ["7"], label: "간선 수가 적은 경로(A→C→D)를 고름" },
        { equals: ["12"], label: "모든 간선 가중치를 합산" },
      ],
    },
  },
  {
    id: "q10", number: 10, type: "short", conceptIds: ["c-dist", "c-clu"],
    stem: "모든 간선 비용이 같은 그래프에서, 시작 정점과 가까운 정점부터 큐(queue)로 차례대로 방문해 최단 경로를 구하는 탐색 알고리즘의 이름은?",
    shortAnswer: {
      policy: "text",
      accepted: ["bfs", "너비 우선 탐색", "너비우선탐색", "bfs 탐색", "breadth-first search", "breadth first search", "너비 우선 검색"],
      misconceptionRules: [
        { includesAll: ["dfs"], label: "DFS와 혼동(스택 사용)" },
        { includesAll: ["깊이"], label: "DFS와 혼동(스택 사용)" },
        { includesAll: ["다익스트라"], label: "다익스트라와 혼동(우선순위 큐)" },
        { includesAll: ["dijkstra"], label: "다익스트라와 혼동(우선순위 큐)" },
        { includesAll: ["이진"], label: "이진 탐색과 혼동" },
      ],
    },
  },
];

// 학생 프로필별 개념 정답 확률은 scripts/shared/cohort.ts의 PROFILE_STRENGTH
const P = PROFILE_STRENGTH;
// 프로필별로 자주 고르는 오답(오개념) — 없으면 균등
const FAVORED_WRONG: Partial<Record<Profile, Record<string, string>>> = {
  pathWeak: { q8: "A", q9: "7" },
  sortWeak: { q2: "A", q5: "B", q4: "C" },
  bigOWeak: { q1: "A", q5: "D", q3: "A" },
};

// 학생·응시·프로필 배정은 rng(SEED)의 첫 소비자여야 한다 (scripts/shared/cohort.ts)
const { students, attempts, profiles } = buildCohort(rand);

const shortCorrectVariants: Record<string, string[]> = {
  q9: ["6", "6.0", " 6", "６", "6.00"],
  q10: ["BFS", "너비 우선 탐색", "breadth-first search", "BFS 탐색", "bfs", "너비우선탐색"],
};
const shortWrongVariants: Record<string, string[]> = {
  q9: ["7", "12", "4", "3.5", "6ms"],
  q10: ["DFS", "깊이 우선 탐색", "다익스트라", "이진 탐색", "dijkstra", "A*"],
};

const responses: Response[] = [];
attempts.forEach((att, idx) => {
  if (att.status !== "finished") return;
  const profile = profiles[idx]!;
  for (const item of items) {
    // 여러 개념이 태그된 문항은 가장 약한 개념의 정답 확률을 쓴다
    const pCorrect = Math.min(...item.conceptIds.map((c) => P[profile][c] ?? 0.6));
    let raw: string | null;
    if (rand() < 0.03) {
      raw = null; // 무응답
    } else if (rand() < pCorrect) {
      raw = item.type === "mcq" ? item.correctOptionId! : pick(shortCorrectVariants[item.id]!);
    } else {
      const favored = FAVORED_WRONG[profile]?.[item.id];
      if (item.type === "mcq") {
        const wrong = item.options!.filter((o) => o.id !== item.correctOptionId).map((o) => o.id);
        raw = weightedPick(wrong.map((w) => [w, w === favored ? 5 : 1] as [string, number]));
      } else {
        const wrong = shortWrongVariants[item.id]!;
        raw = weightedPick(wrong.map((w) => [w, w === favored ? 5 : 1] as [string, number]));
      }
    }
    const gradedState = gradeItem(item, raw);
    responses.push({ attemptId: att.id, itemId: item.id, rawAnswer: raw, gradedState, score: gradedState === "correct" ? 1 : 0 });
  }
});

const course: Course = {
  id: "algo101",
  shortName: "ALGO101",
  fullName: "알고리즘과 자료구조 기초 (2026-2학기)",
  teacher: "김교수",
  sections: [
    { number: 0, title: "General", activities: [{ id: "news", type: "forum", name: "Announcements" }] },
    { number: 1, title: "1주차: 알고리즘과 문제 해결", activities: [{ id: "p1", type: "page", name: "강의 자료: 알고리즘의 표현" }, { id: "f1", type: "forum", name: "질문 게시판" }] },
    { number: 2, title: "2주차: 자료구조 기초", activities: [{ id: "p2", type: "page", name: "강의 자료: 배열·연결 리스트·스택·큐" }, { id: "as2", type: "assign", name: "과제 1: 스택·큐 구현" }] },
    { number: 3, title: "3주차: 재귀와 분할 정복", activities: [{ id: "p3", type: "page", name: "강의 자료: 재귀 호출과 점화식" }] },
    { number: 4, title: "4주차: 정렬과 탐색", activities: [{ id: "p4", type: "page", name: "강의 자료: 정렬 알고리즘" }, { id: "u4", type: "url", name: "참고 영상" }] },
    {
      number: 5,
      title: "5주차: 복잡도와 그래프 탐색",
      summary: "시간복잡도·정렬·그래프 탐색·최단 경로를 점검하는 차시 퀴즈입니다.",
      activities: [
        { id: "p5", type: "page", name: "강의 자료: 그래프 탐색과 최단 경로" },
        { id: "quiz-w5", type: "quiz", name: "5주차 퀴즈: 복잡도와 그래프 탐색 기초", href: "/quiz/quiz-w5/" },
        { id: "quiz-w5e", type: "quiz", name: "5주차 서술형 퀴즈: 알고리즘 분석과 설계", href: "/essay/quiz-w5e/" },
        { id: "f5", type: "forum", name: "5주차 토론" },
      ],
    },
    { number: 6, title: "6주차: 해시와 트리", activities: [{ id: "p6", type: "page", name: "강의 자료: 해시 테이블" }] },
    { number: 7, title: "7주차: 동적 계획법과 탐욕", activities: [{ id: "p7", type: "page", name: "강의 자료: 동적 계획법" }] },
    { number: 8, title: "8주차: 중간 정리", activities: [{ id: "as8", type: "assign", name: "중간 프로젝트" }] },
  ],
};

const dataset: QuizDataset = {
  dataVersion: DATA_VERSION,
  quiz: {
    id: "quiz-w5",
    courseId: course.id,
    sectionNumber: 5,
    name: "5주차 퀴즈: 복잡도와 그래프 탐색 기초",
    intro: "시간복잡도, 정렬, 그래프 탐색, 최단 경로에 관한 10문항(객관식 8, 단답 2)입니다.",
    closeDate: "2026-11-06T23:59:00+09:00",
    concepts,
    items,
  },
  students,
  attempts,
  responses,
};

// 응답 원천은 xAPI Statement다 (docs/xapi-plan.md). 시간 값은 응답과 다른 난수열(TIME_SEED)로 만든다.
const statements = quizStatements(dataset.quiz, attempts, responses, {
  rand: rng(TIME_SEED),
  startFrom: Date.parse("2026-11-02T09:00:00+09:00"),
  startTo: Date.parse("2026-11-06T21:00:00+09:00"),
});
const problems = validateStatements(statements);
if (problems.length) throw new Error(`xAPI 검증 실패 ${problems.length}건: ${JSON.stringify(problems.slice(0, 3))}`);

// 생성한 Statement로 다시 만든 데이터셋이 생성 결과와 같아야 한다
const roundTrip = toQuizDataset({ dataVersion: DATA_VERSION, quiz: dataset.quiz }, students, statements).dataset;
if (JSON.stringify(roundTrip) !== JSON.stringify(dataset)) throw new Error("Statement → 데이터셋 변환 결과가 생성 결과와 다르다");

const outDir = join(process.cwd(), "src", "data");
const xapiDir = join(process.cwd(), "public", "xapi");
mkdirSync(outDir, { recursive: true });
mkdirSync(xapiDir, { recursive: true });
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
write(join(outDir, "course.json"), { dataVersion: DATA_VERSION, course });
write(join(outDir, "quiz-w5.json"), { dataVersion: DATA_VERSION, quiz: dataset.quiz });
write(join(outDir, "roster.json"), { dataVersion: DATA_VERSION, students });
write(join(xapiDir, "quiz-w5.statements.json"), statements);
const byVerb: Record<string, number> = {};
for (const s of statements) byVerb[s.verb.id] = (byVerb[s.verb.id] ?? 0) + 1;
write(join(xapiDir, "quiz-w5.validation.json"), {
  statementsFile: "quiz-w5.statements.json",
  statementDataVersion: STATEMENT_DATA_VERSION,
  validator: VALIDATOR,
  specBasis: SPEC_BASIS,
  statementCount: statements.length,
  byVerb,
  problemCount: problems.length,
});

// 생성 요약 (프로필은 파일에 저장하지 않는다 — 화면이 정답을 미리 알지 않게)
const finished = attempts.filter((a) => a.status === "finished").length;
const correct = responses.filter((r) => r.gradedState === "correct").length;
console.log(`students=${students.length} finished=${finished} responses=${responses.length} correctRate=${(correct / responses.length).toFixed(2)}`);
console.log("profiles:", students.slice(0, finished).map((s, i) => `${s.id}:${profiles[i]}`).join(" "));
