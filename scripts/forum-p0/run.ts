// P0 실패 탐색 실행기. 사용법:
//   npm run forum:p0                 # TF-IDF 두 판 + (캐시가 있으면) Gemini 두 판
//   npm run forum:p0 -- --gemini     # 캐시에 없는 글만 Gemini로 임베딩 (HTTP 요청 2회 안팎)
//   npm run forum:p0 -- --gemini --model=<임베딩 모델 id>
// 표는 docs/forum-claim-map/p0-tables.md 에 다시 쓴다. 판정 규칙은 p0-results.md §4.

import { mkdirSync, writeFileSync } from "node:fs";
import { CLAIMS, D_TWINS, GLOSSARY, LECTURE, LENGTH_IDS, LENGTH_PAD, POSTS, toSentences, type Claim } from "./dataset";
import { fillCache, loadCache, vectorFor, type EmbedRequest, type TaskType } from "./gemini";
import { CharTfidf, denseCosine, sparseCosine, type SparseVec } from "./tfidf";

const args = process.argv.slice(2);
const callGemini = args.includes("--gemini");
const model = args.find((a) => a.startsWith("--model="))?.slice("--model=".length) ?? "gemini-embedding-001";
const OUT_DIR = "docs/forum-claim-map";
const cachePath = `${OUT_DIR}/p0-gemini-${model}.json`;

type Unit = { id: string; text: string; parent: string };
/** simX: 답글 ↔ 강의 단위, simY: 답글 ↔ 원글 */
type Method = { name: string; inG1: boolean; simX: (claim: string, unit: string) => number; simY: (claim: string, post: string) => number };

const claim = (id: string): Claim => {
  const c = CLAIMS.find((x) => x.id === id);
  if (!c) throw new Error(`없는 답글 id: ${id}`);
  return c;
};
const PARAS: Unit[] = LECTURE.map((u) => ({ id: u.id, text: u.text, parent: u.id }));
const SENTS: Unit[] = toSentences(LECTURE);
const PADDED = LENGTH_IDS.map((id) => ({ id, text: LENGTH_PAD + claim(id).text }));
const POST_TEXTS = [POSTS.T1.text, POSTS.T2.text];
/** IDF는 미리 계산할 수 있는 것(강의 문단 + 원글)으로만 학습한다 (S5). */
const IDF_DOCS = [...PARAS.map((u) => u.text), ...POST_TEXTS];
const CLAIM_TEXTS = [...CLAIMS.map((c) => c.text), ...PADDED.map((p) => p.text), ...Object.values(D_TWINS)];
const UNIT_TEXTS = [...PARAS.map((u) => u.text), ...SENTS.map((s) => s.text)];

const RETRIEVABLE = CLAIMS.filter((c) => c.gold.length > 0 && c.category !== "g");
const HARD = RETRIEVABLE.filter((c) => c.category === "d" || c.category === "f");
const G1_ALL = Math.ceil(0.8 * RETRIEVABLE.length);
const G1_HARD = 6;
const TOP_QUARTER = Math.ceil(0.25 * CLAIMS.length);

function tfidfMethod(name: string, inG1: boolean, expand: (t: string) => string): Method {
  const tf = new CharTfidf(2, 4, "max").fit(IDF_DOCS.map(expand));
  const memo = new Map<string, SparseVec>();
  const vec = (t: string) => {
    let v = memo.get(t);
    if (!v) memo.set(t, (v = tf.transform(expand(t))));
    return v;
  };
  const sim = (a: string, b: string) => sparseCosine(vec(a), vec(b));
  return { name, inG1, simX: sim, simY: sim };
}

const withGlossary = (t: string) => {
  const extra = GLOSSARY.filter(([re]) => re.test(t)).map(([, canon]) => canon);
  return extra.length > 0 ? `${t} ${extra.join(" ")}` : t;
};

const GEMINI_REQUESTS: EmbedRequest[] = [
  ...CLAIM_TEXTS.flatMap((text) => [{ text, taskType: "RETRIEVAL_QUERY" as const }, { text, taskType: "SEMANTIC_SIMILARITY" as const }]),
  ...UNIT_TEXTS.flatMap((text) => [{ text, taskType: "RETRIEVAL_DOCUMENT" as const }, { text, taskType: "SEMANTIC_SIMILARITY" as const }]),
  ...POST_TEXTS.map((text) => ({ text, taskType: "SEMANTIC_SIMILARITY" as const })),
];

// ---- 측정 ----
const ranked = (m: Method, text: string, units: Unit[]) =>
  units.map((u) => ({ id: u.id, parent: u.parent, s: m.simX(text, u.text) })).sort((a, b) => b.s - a.s);

function goldRank(m: Method, text: string, gold: string[], units: Unit[]): number {
  const r = ranked(m, text, units).findIndex((u) => gold.includes(u.parent));
  return r < 0 ? Infinity : r + 1;
}

function xScore(m: Method, text: string, units: Unit[], agg: "max" | "top3"): number {
  const r = ranked(m, text, units);
  if (agg === "max") return r[0]!.s;
  const top = r.slice(0, 3);
  return top.reduce((s, u) => s + u.s, 0) / top.length;
}

const yScore = (m: Method, c: Claim) => m.simY(c.text, POSTS[c.thread].text);

/** P(pos > neg), 동점은 0.5 */
function auc(pos: number[], neg: number[]): number {
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "—");
const signed = (x: number) => (x >= 0 ? "+" : "") + f3(x);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2;
};

type Summary = { name: string; hit3: number; hardHit3: number; g1: boolean | null; repro: Record<string, string> };
const REPRO_KEYS = ["a", "b", "c", "d", "f", "g", "길이"] as const;

function evaluate(m: Method, md: string[]): Summary {
  md.push(`\n## ${m.name}\n`);

  // 1. 검색
  md.push("### 1. 검색 (근거 문단 순위)\n", "| 범주 | n | 문단 hit@1 | 문단 hit@3 | 문단 MRR | 문장 hit@3 |", "|---|---|---|---|---|---|");
  const cats = ["a-wrong", "a-right", "b", "c", "d", "e", "f", "h", "i"] as const;
  const groups: [string, Claim[]][] = [
    ...cats.map((cat) => [cat, RETRIEVABLE.filter((c) => c.category === cat)] as [string, Claim[]]),
    ["어려운 묶음 (d + f1~f3)", HARD],
    ["전체", RETRIEVABLE],
  ];
  const paraRank = new Map(RETRIEVABLE.map((c) => [c.id, goldRank(m, c.text, c.gold, PARAS)]));
  const sentRank = new Map(RETRIEVABLE.map((c) => [c.id, goldRank(m, c.text, c.gold, SENTS)]));
  const hit = (rs: number[], k: number) => rs.filter((r) => r <= k).length;
  for (const [label, cs] of groups) {
    if (cs.length === 0) continue;
    const pr = cs.map((c) => paraRank.get(c.id)!);
    const sr = cs.map((c) => sentRank.get(c.id)!);
    const mrr = pr.reduce((s, r) => s + 1 / r, 0) / pr.length;
    md.push(`| ${label} | ${cs.length} | ${hit(pr, 1)} | ${hit(pr, 3)} | ${mrr.toFixed(2)} | ${hit(sr, 3)} |`);
  }
  const misses = RETRIEVABLE.filter((c) => paraRank.get(c.id)! > 3);
  md.push(
    "\n**상위 3 밖 (문단 단위):** " +
      (misses.length === 0 ? "없음" : misses.map((c) => `${c.id}(근거 ${c.gold.join("/")}, 순위 ${paraRank.get(c.id)}, 1위 ${ranked(m, c.text, PARAS)[0]!.id})`).join(", ")),
  );
  const hit3 = RETRIEVABLE.filter((c) => paraRank.get(c.id)! <= 3).length;
  const hardHit3 = HARD.filter((c) => paraRank.get(c.id)! <= 3).length;

  // 2. 오개념 쌍 (반례 a)
  md.push("\n### 2. 오개념 쌍: X(최댓값, 문단)\n", "| 쌍 | X 틀린 글 | X 맞는 글 | 차이(틀림−맞음) | 1위 문단 (틀림/맞음) |", "|---|---|---|---|---|");
  const wrongs = CLAIMS.filter((c) => c.category === "a-wrong");
  const rights = CLAIMS.filter((c) => c.category === "a-right");
  let rightWins = 0;
  for (const w of wrongs) {
    const r = claim(w.pair!);
    const xw = xScore(m, w.text, PARAS, "max");
    const xr = xScore(m, r.text, PARAS, "max");
    if (xr > xw) rightWins += 1;
    md.push(`| ${w.id}/${r.id} | ${f3(xw)} | ${f3(xr)} | ${signed(xw - xr)} | ${ranked(m, w.text, PARAS)[0]!.id}/${ranked(m, r.text, PARAS)[0]!.id} |`);
  }
  md.push(`\n맞는 글의 X가 더 높은 쌍: ${wrongs.length}쌍 중 ${rightWins}쌍 (우연이면 절반 안팎)`);
  md.push("\n**분할 × 집계별 AUC** (서술용, P[맞는 글 X > 틀린 글 X], 0.5 = 가르지 못함)\n", "| 설정 | a 쌍만 | 근거 있는 전체 (맞음+조건부 vs 틀림) |", "|---|---|---|");
  const okAll = RETRIEVABLE.filter((c) => c.relation === "consistent" || c.relation === "conditional");
  const badAll = RETRIEVABLE.filter((c) => c.relation === "contradicts");
  for (const [gname, units] of [["문단", PARAS], ["문장", SENTS]] as const) {
    for (const agg of ["max", "top3"] as const) {
      const x = (c: Claim) => xScore(m, c.text, units, agg);
      md.push(`| ${gname} · ${agg === "max" ? "최댓값" : "상위 3 평균"} | ${auc(rights.map(x), wrongs.map(x)).toFixed(2)} | ${auc(okAll.map(x), badAll.map(x)).toFixed(2)} (${okAll.length} vs ${badAll.length}) |`);
    }
  }

  // 3. 찬반과 틀린 원글 (반례 b, c)
  md.push("\n### 3. Y (원글과의 유사도)\n", "| 답글 | 스레드 | 태도 | 강의와의 관계 | Y |", "|---|---|---|---|---|");
  const yIds = ["b1", "b2", "b3", "b4", "h2", "i3", "a2w", "a2r", "e1", "c1", "c2", "i1", "a1w", "a1r", "d3", "f3", "e3"];
  const yRows = yIds.map((id) => ({ c: claim(id), y: yScore(m, claim(id)) }));
  for (const t of ["T1", "T2"] as const) {
    for (const { c, y } of yRows.filter((r) => r.c.thread === t).sort((a, b) => b.y - a.y)) md.push(`| ${c.id} | ${t} | ${c.stance} | ${c.relation} | ${f3(y)} |`);
  }
  const Y = (id: string) => yScore(m, claim(id));
  const t2 = CLAIMS.filter((c) => c.thread === "T2");
  const aucT2 = auc(t2.filter((c) => c.stance === "oppose").map((c) => yScore(m, c)), t2.filter((c) => c.stance === "agree").map((c) => yScore(m, c)));
  md.push(`\nT2(틀린 원글)에서 P[반박 글 Y > 동의 글 Y] = ${aucT2.toFixed(2)} (높을수록 Y가 옳은 쪽을 멀게 본다)`);

  // 4. X 분포 (반례 f, 게이밍)
  md.push("\n### 4. X(최댓값, 문단) 분포\n", "| 묶음 | n | 최솟값 | 중앙값 | 최댓값 |", "|---|---|---|---|---|");
  const X = (c: Claim) => xScore(m, c.text, PARAS, "max");
  const dist: [string, Claim[]][] = [
    ["맞음·조건부 (근거 있음)", okAll],
    ["틀림", badAll],
    ["강의에 없음 (f4, f5)", [claim("f4"), claim("f5")]],
    ["잡담·짧은 글·대명사 (h1, h2, i3)", [claim("h1"), claim("h2"), claim("i3")]],
    ["용어 나열 g1 / 강의 복사 g2", [claim("g1"), claim("g2")]],
  ];
  for (const [label, cs] of dist) {
    const xs = cs.map(X);
    md.push(`| ${label} | ${cs.length} | ${f3(Math.min(...xs))} | ${f3(median(xs))} | ${f3(Math.max(...xs))} |`);
  }
  // 동점은 답글 목록 순서 (안정 정렬)
  const byX = [...CLAIMS].sort((a, b) => X(b) - X(a)).map((c) => c.id);
  const xRank = (id: string) => byX.indexOf(id) + 1;
  const okMin = Math.min(...okAll.map(X));
  const uncoveredMax = Math.max(X(claim("f4")), X(claim("f5")));
  const below = okAll.filter((c) => X(c) < uncoveredMax).map((c) => c.id);
  md.push(`\nX 순위(${CLAIMS.length}개 중, 상위 25% = ${TOP_QUARTER}위까지): g1 ${xRank("g1")}위, g2 ${xRank("g2")}위, f4 ${xRank("f4")}위, f5 ${xRank("f5")}위, h1 ${xRank("h1")}위, i3 ${xRank("i3")}위.`);
  md.push(`강의에 없는 글(f4·f5) 중 높은 쪽보다 X가 낮은 맞는 글: ${below.length}개${below.length ? ` (${below.join(", ")})` : ""}`);

  // 5. 동의어 쌍둥이 (반례 d)
  md.push("\n### 5. 동의어: 영문·별칭 판 vs 강의 용어 쌍둥이\n", "| 답글 | 근거 순위 영문→쌍둥이 | X 영문→쌍둥이 |", "|---|---|---|");
  let dWorse = 0;
  for (const [id, twin] of Object.entries(D_TWINS)) {
    const c = claim(id);
    const [re, rt] = [goldRank(m, c.text, c.gold, PARAS), goldRank(m, twin, c.gold, PARAS)];
    if (re > rt) dWorse += 1;
    md.push(`| ${id} | ${re} → ${rt} | ${f3(X(c))} → ${f3(xScore(m, twin, PARAS, "max"))} |`);
  }

  // 6. 길이 민감도
  md.push("\n### 6. 길이 민감도 (앞에 무관한 사연을 붙임)\n", "| 답글 | X 최댓값 짧음→김 | X 상위3평균 짧음→김 | 근거 순위 짧음→김 |", "|---|---|---|---|");
  const deltas: number[] = [];
  for (const p of PADDED) {
    const c = claim(p.id);
    const [s1, l1] = [xScore(m, c.text, PARAS, "max"), xScore(m, p.text, PARAS, "max")];
    const [s3, l3] = [xScore(m, c.text, PARAS, "top3"), xScore(m, p.text, PARAS, "top3")];
    deltas.push(l1 - s1);
    md.push(`| ${p.id} | ${f3(s1)} → ${f3(l1)} | ${f3(s3)} → ${f3(l3)} | ${goldRank(m, c.text, c.gold, PARAS)} → ${goldRank(m, p.text, c.gold, PARAS)} |`);
  }
  const meanDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;

  const yes = (b: boolean) => (b ? "재현" : "재현 안 됨");
  const repro: Record<(typeof REPRO_KEYS)[number], string> = {
    a: `${yes(rightWins <= 4)} (맞는 글 우세 ${rightWins}/6)`,
    b: `${yes(["b2", "b3", "b4"].every((id) => Y("b1") > Y(id)) && Y("b2") > Y("b3"))} (b1 ${f3(Y("b1"))}, b2 ${f3(Y("b2"))}, b3 ${f3(Y("b3"))})`,
    c: `${yes(Y("c1") > Y("c2"))} (c1 ${f3(Y("c1"))}, c2 ${f3(Y("c2"))})`,
    d: `${yes(dWorse >= 3)} (영문 판 순위가 나쁨 ${dWorse}/6)`,
    f: `${yes(X(claim("f4")) >= okMin && X(claim("f5")) >= okMin)} (f4 ${f3(X(claim("f4")))}, f5 ${f3(X(claim("f5")))}, 맞는 글 최솟값 ${f3(okMin)})`,
    g: `${yes(xRank("g1") <= TOP_QUARTER)} (g1 ${xRank("g1")}위)`,
    길이: `${yes(meanDelta <= -0.05)} (평균 ${signed(meanDelta)})`,
  };
  const g1 = m.inG1 ? hit3 >= G1_ALL && hardHit3 >= G1_HARD : null;
  return { name: m.name, hit3, hardHit3, g1, repro };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const methods: Method[] = [tfidfMethod("TF-IDF", true, (t) => t), tfidfMethod("TF-IDF + 용어집 (참고)", false, withGlossary)];

  const cache = loadCache(cachePath, model);
  let sent = 0;
  if (callGemini) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY가 .env에 없습니다.");
    sent = await fillCache({ apiKey, requests: GEMINI_REQUESTS, cache, cachePath });
  }
  const geminiReady = GEMINI_REQUESTS.every((r) => vectorFor(cache, r));
  if (geminiReady) {
    const v = (text: string, taskType: TaskType) => vectorFor(cache, { text, taskType })!;
    const simSim = (a: string, b: string) => denseCosine(v(a, "SEMANTIC_SIMILARITY"), v(b, "SEMANTIC_SIMILARITY"));
    methods.push(
      { name: `Gemini 검색형 (${model}, QUERY/DOCUMENT)`, inG1: true, simX: (c, u) => denseCosine(v(c, "RETRIEVAL_QUERY"), v(u, "RETRIEVAL_DOCUMENT")), simY: simSim },
      { name: `Gemini 유사도형 (${model}, SIMILARITY, 참고)`, inG1: false, simX: simSim, simY: simSim },
    );
  }

  const md = [
    "# P0 표 (자동 생성, 손으로 고치지 않는다)",
    "",
    `- 생성: ${new Date().toISOString()} · 답글 ${CLAIMS.length}개, 검색 대상 ${RETRIEVABLE.length}개, 어려운 묶음 ${HARD.length}개`,
    `- Gemini: ${geminiReady ? `요청 모델 \`${model}\`, 캐시의 HTTP 호출 기록 ${cache.calls.length}건 (이번 실행 새 요청 ${sent})` : "결과 없음"}`,
  ];
  const summaries = methods.map((m) => evaluate(m, md));

  const eligible = summaries.filter((s) => s.g1 !== null);
  const passed = eligible.filter((s) => s.g1).map((s) => s.name);
  const verdict =
    passed.length > 0 ? `중단 신호 없음 (${passed.join(", ")})` : geminiReady ? "중단 신호 (거리 경로 중단)" : "보류 (TF-IDF 미달, Gemini 결과 없음)";
  md.splice(
    4,
    0,
    "",
    "## 요약",
    "",
    `G1 통과선: 문단 hit@3 ≥ ${G1_ALL}/${RETRIEVABLE.length}, 어려운 묶음 ≥ ${G1_HARD}/${HARD.length}. 통과는 "이 자료에서 중단할 실패가 안 나왔다"는 뜻일 뿐이다.`,
    "",
    `| 방법 | 문단 hit@3 | 어려운 묶음 hit@3 | G1 | ${REPRO_KEYS.join(" | ")} |`,
    `|---|---|---|---|${REPRO_KEYS.map(() => "---").join("|")}|`,
    ...summaries.map(
      (s) =>
        `| ${s.name} | ${s.hit3} (여유 ${s.hit3 - G1_ALL >= 0 ? "+" : ""}${s.hit3 - G1_ALL}) | ${s.hardHit3} | ${s.g1 === null ? "참고" : s.g1 ? "통과" : "미달"} | ${REPRO_KEYS.map((k) => s.repro[k]).join(" | ")} |`,
    ),
    "",
    `**G1: ${verdict}**`,
  );
  writeFileSync(`${OUT_DIR}/p0-tables.md`, md.join("\n") + "\n");

  for (const s of summaries) console.log(`${s.name}: hit@3 ${s.hit3}/${RETRIEVABLE.length}, 어려운 ${s.hardHit3}/${HARD.length}, G1 ${s.g1 === null ? "참고" : s.g1 ? "통과" : "미달"}`);
  console.log(`G1: ${verdict}  →  ${OUT_DIR}/p0-tables.md`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
