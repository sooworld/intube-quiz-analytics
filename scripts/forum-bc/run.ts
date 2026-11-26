// B2 용도별 검증 (TF-IDF만). 실행: npm run forum:bc  →  docs/forum-claim-map/b2-tables.md (자동 생성 표)
// 기준값·설정은 docs/forum-claim-map/b0-prereg.md §6·§7에 출력 전에 고정했다. 해석은 b2-results.md에 사람이 쓴다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMON, designGaps, diffChecklists, fitForum, lexicalCandidates, lexicalDesignMap, pairScores, parentOverlaps, type Checklist } from "../../src/lib/forum/analysis";
import { designMock, profileMock } from "../../src/lib/forum/mockRules";
import { exampleChecklist } from "../../src/lib/forum/state";
import { passageQuotes, stripQuoted } from "../../src/lib/forum/text";
import { FORUM_F5 } from "../../src/lib/forum/content/f5";
import { FORUM_LIT_F3 } from "../../src/lib/forum/content/litF3";
import { sparseCosine } from "../../src/lib/forum/tfidf";
import { RESPONSE_FUNCTION_LABEL, type CellJudgment, type ForumDataset } from "../../src/lib/forum/types";
import { INTENT, PAIRS, type PairType } from "./gold";
import { VARIANTS } from "./variants";

const FORUMS: ForumDataset[] = [FORUM_F5, FORUM_LIT_F3];
const f2 = (x: number) => x.toFixed(2);
const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((a / b) * 100)}%`);
const lines: string[] = [];
const out = (s = "") => lines.push(s);

out("# B2 자동 생성 표 (TF-IDF, 합성 글)");
out();
out(`> 생성: \`npm run forum:bc\` (${new Date().toISOString().slice(0, 10)}). 손으로 고치지 않는다. 해석은 \`b2-results.md\`.`);
out("> 모든 수치는 **합성 글**(설계자가 씀)에서 나왔다. 작성자·스레드 수는 합성 시나리오의 수이며 독립 표본 수가 아니다.");
out();

export interface S2Row {
  forumId: string;
  k: number;
  n: number;
  primaryHit: number;
  allowedHit: number;
  baselineHit: number;
}
const s2Rows: S2Row[] = [];
const s3Flips: Record<string, number> = {};

for (const ds of FORUMS) {
  const intent = INTENT[ds.forum.id]!;
  const v = fitForum(ds);
  out(`## ${ds.forum.id} — ${ds.forum.name}`);
  out();

  // ── S1 ──
  const lm = lexicalDesignMap(ds, v);
  out("### S1 설계 지도 — 어휘 연관도 (목표 × Q 문서 코사인)");
  out();
  out(`| 목표 | ${ds.subQuestions.map((q) => q.id).join(" | ")} | 공통(안내 글) | Q 최대 |`);
  out(`|---|${ds.subQuestions.map(() => "---:").join("|")}|---:|---:|`);
  for (const o of ds.objectives) {
    const cell = (t: string) => f2(lm.cells.find((c) => c.objectiveId === o.id && c.target === t)!.cosine);
    out(`| ${o.id} | ${ds.subQuestions.map((q) => cell(q.id)).join(" | ")} | ${cell(COMMON)} | ${f2(lm.maxByObjective[o.id] ?? 0)} |`);
  }
  out();
  out(`- O×Q 칸 하위 25% 경계: ${f2(lm.q1Threshold)}. 최대값이 경계 이하인 목표(탐색용 공백 후보): ${lm.lowObjectives.join(", ") || "없음"}`);
  out(`- 설계자 체크표의 공백: O3. 사전 예측("TF-IDF는 O3를 공백으로 못 잡는다"): ${lm.lowObjectives.includes("O3") ? "**틀림** (O3가 하위 25%에 듦)" : "**맞음** (O3가 하위 25%에 들지 않음)"}`);
  const rank = [...ds.objectives].sort((a, b) => (lm.maxByObjective[a.id] ?? 0) - (lm.maxByObjective[b.id] ?? 0)).map((o) => `${o.id} ${f2(lm.maxByObjective[o.id] ?? 0)}`);
  out(`- 목표별 Q 최대값 오름차순: ${rank.join(" < ")}`);
  out();

  // ── S1 참고: 규칙 기반(Mock) 요구 판정과 설계자 체크표 ──
  const ruleCl: Record<string, CellJudgment> = {};
  for (const c of designMock(ds).cells) ruleCl[`${c.objectiveId}|${c.target}`] = c.judgment;
  const exCl = exampleChecklist(ds, "t").cells;
  const rg = designGaps(ds, ruleCl as Checklist);
  const eg = designGaps(ds, exCl);
  const dd = diffChecklists(ds, exCl, ruleCl as Checklist);
  out("### S1 참고: 규칙 기반(Mock) 요구 판정 vs 설계자 체크표");
  out();
  out(`- 설계 공백: 설계자 ${eg.uncoveredObjectives.join(", ") || "없음"} / 규칙 ${rg.uncoveredObjectives.join(", ") || "없음"}. 목표와 이어지지 않는 Q: 설계자 ${eg.unlinkedQuestions.join(", ") || "없음"} / 규칙 ${rg.unlinkedQuestions.join(", ") || "없음"}`);
  out(`- 다른 칸 ${dd.length}개 (설계자 → 규칙): ${dd.map((d) => `${d.objectiveId}×${d.target === COMMON ? "공통" : d.target} ${d.a}→${d.b}`).join(", ")}`);
  out();
  if (ds.work) {
    out("### C형 참고: 작품에서 그대로 찾지 못한 인용 표시");
    out();
    for (const p of ds.posts) {
      const bad = passageQuotes(p.text, ds.work).filter((q) => !q.inWork);
      if (bad.length) out(`- ${p.id} (${INTENT[ds.forum.id]![p.id]!.roles.join(", ") || "—"}): ${bad.map((b) => `“${b.quote}”`).join(", ")}`);
    }
    out();
  }

  // ── S2 ──
  const cands = lexicalCandidates(ds, v);
  const assigned = ds.posts.filter((p) => intent[p.id]!.primary.startsWith("Q"));
  const freq = ds.subQuestions
    .map((q) => ({ id: q.id, n: assigned.filter((p) => intent[p.id]!.primary === q.id).length }))
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
    .map((x) => x.id);
  out("### S2 K1 후보 생성 — 상위 k에 의도 주 배정 Q가 드는가");
  out();
  out(`분모: 의도 주 배정이 Q인 글 ${assigned.length}개 (new·off·hold 제외). 빈도 기준선: 의도 라벨에서 글이 가장 많은 Q 순서 ${freq.join(" > ")} 의 앞 k개.`);
  out();
  out("| k | 주 배정 포함 | 누락률 | 주·부 중 하나라도 포함 (느슨한 기준) | 빈도 기준선 포함 |");
  out("|---:|---:|---:|---:|---:|");
  for (const k of [1, 2, 3, 4]) {
    let prim = 0;
    let allowed = 0;
    let base = 0;
    for (const p of assigned) {
      const top = cands[p.id]!.slice(0, k).map((c) => c.qId);
      const it = intent[p.id]!;
      if (top.includes(it.primary)) prim++;
      if (top.some((q) => q === it.primary || it.secondary.includes(q))) allowed++;
      if (freq.slice(0, k).includes(it.primary)) base++;
    }
    s2Rows.push({ forumId: ds.forum.id, k, n: assigned.length, primaryHit: prim, allowedHit: allowed, baselineHit: base });
    out(`| ${k} | ${prim}/${assigned.length} | ${pct(assigned.length - prim, assigned.length)} | ${allowed}/${assigned.length} | ${base}/${assigned.length} |`);
  }
  out();
  out("k=2 누락 사례 (전부):");
  out();
  out("| 글 | 의도 | 역할 | 상위 4 (코사인) |");
  out("|---|---|---|---|");
  for (const p of assigned) {
    const it = intent[p.id]!;
    const c = cands[p.id]!;
    if (c.slice(0, 2).some((x) => x.qId === it.primary)) continue;
    out(`| ${p.id} | ${it.primary}${it.secondary.length ? ` (+${it.secondary.join(",")})` : ""} | ${it.roles.join(", ") || "—"} | ${c.map((x) => `${x.qId} ${f2(x.cosine)}`).join(" · ")} |`);
  }
  out();

  // ── S3 ──
  out("### S3 표현 변형 — TF-IDF 1위 Q가 바뀌는가");
  out();
  out("| 원본 | 변형 | 의도 | 원본 1위 (1·2위 차) | 변형 1위 (1·2위 차) | 1위 전환 | 상위 2 유지 | 의도와 다른 1위 유지 |");
  out("|---|---|---|---|---|---|---|---|");
  let flips = 0;
  let top2Changed = 0;
  let wrongKept = 0;
  for (const vr of VARIANTS.filter((x) => x.forumId === ds.forum.id)) {
    const rankOf = (vec: ReturnType<typeof v.model.transform>) =>
      ds.subQuestions.map((q) => ({ qId: q.id, cosine: sparseCosine(vec, v.question.get(q.id)!) })).sort((a, b) => b.cosine - a.cosine || a.qId.localeCompare(b.qId));
    const o = cands[vr.sourceId]!;
    const n = rankOf(v.model.transform(vr.text));
    const flip = o[0]!.qId !== n[0]!.qId;
    if (flip) flips++;
    const keep2 = new Set(o.slice(0, 2).map((x) => x.qId));
    const kept = n.slice(0, 2).every((x) => keep2.has(x.qId));
    if (!kept) top2Changed++;
    const want = intent[vr.sourceId]!.primary;
    const wrong = o[0]!.qId !== want && n[0]!.qId !== want;
    if (wrong) wrongKept++;
    out(`| ${vr.sourceId} | ${vr.kind} | ${want} | ${o[0]!.qId} (${f2(o[0]!.cosine - o[1]!.cosine)}) | ${n[0]!.qId} (${f2(n[0]!.cosine - n[1]!.cosine)}) | ${flip ? "**전환**" : "—"} | ${kept ? "예" : "**아니오**"} | ${wrong ? "**예**" : "—"} |`);
  }
  s3Flips[ds.forum.id] = flips;
  out();
  out(`- 1위 전환: ${flips}/6 · 상위 2 집합 바뀜: ${top2Changed}/6 · 원본과 변형 모두 의도와 다른 1위: ${wrongKept}/6`);
  out();

  // ── S4 ──
  out("### S4 표현 중복 — 글 쌍 코사인 (인용 제거 전·후)");
  out();
  const raw = pairScores(ds, { stripQuotes: false });
  const stripped = pairScores(ds, { stripQuotes: true });
  const key = (a: string, b: string) => [a, b].sort().join("~");
  const rawMap = new Map(raw.map((p) => [key(p.a, p.b), p.cosine]));
  const strMap = new Map(stripped.map((p) => [key(p.a, p.b), p.cosine]));
  const pairs = PAIRS[ds.forum.id]!;
  const shouldFlag = (t: PairType) => t === "copy" || t === "partial-copy";
  out("| 쌍 | 유형 | 제거 전 | 제거 후 | 남은 글자 수 (a / b) |");
  out("|---|---|---:|---:|---|");
  const textOf = (id: string) => ds.posts.find((p) => p.id === id)!.text;
  for (const pr of pairs) {
    const k = key(pr.a, pr.b);
    out(`| ${pr.a}–${pr.b} | ${pr.type} | ${f2(rawMap.get(k)!)} | ${f2(strMap.get(k)!)} | ${[...stripQuoted(textOf(pr.a), ds.work)].length} / ${[...stripQuoted(textOf(pr.b), ds.work)].length} |`);
  }
  out();
  const nPos = pairs.filter((p) => shouldFlag(p.type)).length;
  const nQuote = pairs.length - nPos;
  const nOther = ds.posts.length * (ds.posts.length - 1) / 2 - pairs.length;
  out(`분모: 복사·부분 복사 ${nPos}쌍, 같은 구절 쌍 ${nQuote}쌍, 그 밖의 쌍 ${nOther}쌍. 양성 쌍이 ${nPos}개뿐이라 미탐 0은 거의 정보가 없다.`);
  out();
  out("| τ | 조건 | 미탐 / 복사·부분 복사 | 오탐 / 같은 구절 쌍 | 오탐 / 그 밖의 쌍 | 후보 쌍 수 | 오류 쌍 |");
  out("|---:|---|---:|---:|---:|---:|");
  const gold = new Map(pairs.map((p) => [key(p.a, p.b), p.type]));
  for (const tau of [0.3, 0.4, 0.5, 0.6]) {
    for (const [label, m] of [["제거 전", rawMap], ["제거 후", strMap]] as const) {
      const flagged = [...m].filter(([, c]) => c >= tau).map(([k]) => k);
      const fn = pairs.filter((p) => shouldFlag(p.type) && !flagged.includes(key(p.a, p.b))).length;
      const fpQuote = pairs.filter((p) => !shouldFlag(p.type) && flagged.includes(key(p.a, p.b))).length;
      const fpOther = flagged.filter((k) => !gold.has(k)).length;
      const errs = [
        ...pairs.filter((p) => shouldFlag(p.type) && !flagged.includes(key(p.a, p.b))).map((p) => `미탐 ${p.a}–${p.b}`),
        ...pairs.filter((p) => !shouldFlag(p.type) && flagged.includes(key(p.a, p.b))).map((p) => `오탐 ${p.a}–${p.b}`),
        ...flagged.filter((k) => !gold.has(k)).map((k) => `오탐 ${k.replace("~", "–")}`),
      ];
      out(`| ${tau} | ${label} | ${fn}/${nPos} | ${fpQuote}/${nQuote} | ${fpOther}/${nOther} | ${flagged.length} | ${errs.join(", ") || "—"} |`);
    }
  }
  out();
  out("제거 후 상위 5쌍:");
  out();
  for (const p of stripped.slice(0, 5)) out(`- ${p.a}–${p.b} ${f2(p.cosine)}${gold.has(key(p.a, p.b)) ? ` (${gold.get(key(p.a, p.b))})` : ""}`);
  out();

  // ── 규칙 기반(Mock) 결과와 의도 라벨 비교: 순환이므로 성능 근거가 아니다. 불일치 사례만 데모의 "도구가 틀리는 예"로 쓴다 ──
  const mock = profileMock(ds, cands, parentOverlaps(ds));
  out("### 참고: 규칙 기반(Mock) 배정과 의도 라벨이 다른 글");
  out();
  out("> **순환 주의:** Mock 단서는 목표·Q 문장에서 기계적으로 옮겼지만, 글과 라벨도 같은 사람이 썼다. 일치율은 성능 근거가 아니다. 아래 불일치만 \"규칙이 틀리는 예\"로 쓴다.");
  out();
  out("| 글 | 의도 주 배정 | 규칙 주 배정 | 의도 기능 | 규칙 기능 | 역할 |");
  out("|---|---|---|---|---|---|");
  let agreeP = 0;
  let agreeF = 0;
  for (const p of ds.posts) {
    const it = intent[p.id]!;
    const m = mock.posts.find((x) => x.postId === p.id)!;
    if (m.primary === it.primary) agreeP++;
    if (m.function === it.fn) agreeF++;
    if (m.primary !== it.primary || m.function !== it.fn)
      out(`| ${p.id} | ${it.primary} | ${m.primary} | ${RESPONSE_FUNCTION_LABEL[it.fn]} | ${RESPONSE_FUNCTION_LABEL[m.function as keyof typeof RESPONSE_FUNCTION_LABEL] ?? m.function} | ${it.roles.join(", ") || "—"} |`);
  }
  out();
  out(`- 주 배정 같음 ${agreeP}/${ds.posts.length}, 기능 같음 ${agreeF}/${ds.posts.length} (순환, 성능 근거 아님)`);
  out();
}

// ── 판정 요약 (b0-prereg.md §7 규칙을 기계적으로 적용) ──
out("## 판정 요약 (사전 고정 규칙 적용)");
out();
for (const ds of FORUMS) {
  const r2 = s2Rows.find((r) => r.forumId === ds.forum.id && r.k === 2)!;
  const miss = (r2.n - r2.primaryHit) / r2.n;
  out(`- **${ds.forum.id}** S2: k=2 누락률 ${pct(r2.n - r2.primaryHit, r2.n)} (기준 25%) / 빈도 기준선 ${r2.baselineHit}/${r2.n} vs TF-IDF ${r2.primaryHit}/${r2.n} → ${miss > 0.25 || r2.primaryHit <= r2.baselineHit ? "**중단 규칙 해당**: TF-IDF는 어휘 후보로만, 모든 Q 선택 가능" : "이 합성 사례에서 중단 조건 미발견 (성능 근거 아님, 화면 구조는 같음)"}`);
  out(`- **${ds.forum.id}** S3: 1위 전환 ${s3Flips[ds.forum.id]}/6 → ${s3Flips[ds.forum.id]! > 0 ? "**반례 있음**: TF-IDF 1위를 배정 기본값으로 쓰지 않음" : "이 합성 사례에서 1위 전환 미발견 (1·2위 차가 작은 글과 상위 2 변화는 위 표 참고)"}`);
}
const totalFlips = Object.values(s3Flips).reduce((a, b) => a + b, 0);
out(`- S3 합계 ${totalFlips}/12 (잠정 제안값 3/12)`);
out("- S1: 결과와 무관하게 TF-IDF는 어휘 연관도로만 표시 (사전 고정). S4: 결과와 무관하게 \"표현 중복 후보 · 원문 대조 필요\"로만 표시. S5: 미실시.");

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "..", "docs", "forum-claim-map", "b2-tables.md");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, lines.join("\n") + "\n");
console.log(`wrote ${target}`);
