// S5 LLM 부분 보고: 저장한 LG 원문을 지금의 검증기로 다시 검사하고, 의도 라벨·규칙 기반(Mock) 결과와 나란히 적는다. 호출하지 않는다.
// 실행: npm run forum:s5  →  docs/forum-claim-map/s5-lg-tables.md (표), src/data/forum-live-lg.json (데모 "실연 기록" 탭용 요약)
// 기준: docs/forum-claim-map/b0-prereg.md §9. 의도 라벨과 같아도 성능 근거가 아니다(순환, 1회 실행).
// 차수를 섞지 않는다: 1차 기본 설정 운영 실패 · 2차 설정 변경 탐색 · 3차 첨언 프롬프트 교정 · 4차 구조 변경 확인 (Codex 균형 검토 7).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateForumComment, type ForumCommentInput, type ForumCommentResult } from "../../src/lib/ai/tasks/forumComment";
import { validateForumDesign, type ForumDesignInput } from "../../src/lib/ai/tasks/forumDesign";
import { forumProfileTask, validateForumProfile, type ForumProfileInput, type ForumProfileResult } from "../../src/lib/ai/tasks/forumProfile";
import { COMMON, designGaps, diffChecklists, type Checklist } from "../../src/lib/forum/analysis";
import { FORUM_F5 } from "../../src/lib/forum/content/f5";
import { FORUM_LIT_F3 } from "../../src/lib/forum/content/litF3";
import { designInput, profileInput } from "../../src/lib/forum/inputs";
import { exampleChecklist } from "../../src/lib/forum/state";
import { RESPONSE_FUNCTION_LABEL, type CellJudgment, type ForumDataset } from "../../src/lib/forum/types";
import { INTENT } from "./gold";

const MODEL = "k-exaone_v2.5";
const DATE = "2026-11-26";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const dir = join(root, "tests", "fixtures", "live");
/** b0-prereg §9에서 미리 정한 규칙 실패 사례 */
const RULE_FAILURES: Record<string, string[]> = { f5: ["b04", "b06", "b12", "b16", "b17"], "lit-f3": ["c05", "c06", "c15", "c17"] };

interface LiveRecord {
  ok: boolean;
  run?: number;
  part?: string | null;
  status?: string;
  validatorVersion?: string;
  promptVersion?: string;
  raw?: unknown;
  input?: unknown;
  error?: { kind: string; status: number | null; message: string };
  durationMs?: number;
  usage?: { completionTokens: number | null; reasoningTokens: number | null } | null;
  request?: { maxTokens?: number };
}

const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("forum-") && f.includes(MODEL) && f.includes(DATE)).sort() : [];
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as LiveRecord;
const runOf = (f: string) => (f.endsWith("-r2-429.json") ? "429" : (/-r(\d)\.json$/.exec(f)?.[1] ?? "1"));
const pick = (run: string, task: string, forumId: string) => files.filter((f) => f.startsWith(`forum-${task}-${forumId}-`) && runOf(f) === run).map((f) => ({ file: f, rec: load(f) }));
const secs = (r: LiveRecord) => Math.round((r.durationMs ?? 0) / 1000);

/** 지금 검증기 판정 (기록 당시 판정은 파일의 status) */
function currentStatus(f: string, r: LiveRecord): string | null {
  if (!r.ok || r.input === undefined) return null;
  if (f.startsWith("forum-design-")) return validateForumDesign(r.raw, r.input as never).status;
  if (f.startsWith("forum-profile-")) return validateForumProfile(r.raw, r.input as ForumProfileInput).status;
  if (f.startsWith("forum-comment-")) return validateForumComment(r.raw, r.input as ForumCommentInput).status;
  return null;
}

const lines: string[] = [];
const out = (s = "") => lines.push(s);
const calls: unknown[] = [];
const forums: Record<string, Record<string, unknown>> = {};

out("# S5 LLM 부분 — LG EXAONE 실연 표 (합성 글)");
out();
out(`> 생성: \`npm run forum:s5\`. 원문은 \`tests/fixtures/live/forum-*-${MODEL}-${DATE}*.json\`. 판정은 **기록 당시**(그때 검증기)와 **지금 검증기**를 함께 적는다.`);
out("> temperature 0, 추론 low, 재시도 없음. 의도 라벨은 같은 사람이 썼으므로 일치는 성능 근거가 아니다(b0-prereg §0·§9).");
out("> 차수: 1차 기본 설정 운영 실패 · 2차 설정 변경 탐색(상한 16000, 6개씩) · 429 미실행분(서비스 과부하, 같은 설정으로 다시 보냄) · 3차 첨언 프롬프트 v2 · 4차 구조 변경 확인(첨언 v3·글별 근거 v3).");
out();
out("## 모든 호출");
out();
out("| 차수 | 기록 | 결과 | 기록 당시 판정 (검증기) | 지금 판정 | 초 | 출력 토큰 (추론) |");
out("|---|---|---|---|---|---:|---|");
for (const f of files) {
  const r = load(f);
  const cur = currentStatus(f, r);
  calls.push({ file: f, run: runOf(f), ok: r.ok, recorded: r.status ?? null, current: cur, seconds: secs(r), tokens: r.usage?.completionTokens ?? null, reasoning: r.usage?.reasoningTokens ?? null, error: r.error?.kind ?? null });
  out(`| ${runOf(f)} | ${f.replace(`-${MODEL}-${DATE}`, "")} | ${r.ok ? "성공" : `실패 (${r.error?.kind})`} | ${r.status ? `${r.status} (v${r.validatorVersion ?? "?"})` : "—"} | ${cur ?? "—"} | ${secs(r)} | ${r.usage ? `${r.usage.completionTokens} (${r.usage.reasoningTokens})` : "—"} |`);
}
out();

for (const ds of [FORUM_F5, FORUM_LIT_F3] as ForumDataset[]) {
  const intent = INTENT[ds.forum.id]!;
  const fsum: Record<string, unknown> = {};
  forums[ds.forum.id] = fsum;
  out(`## ${ds.forum.id} — ${ds.forum.name}`);
  out();

  for (const { rec } of pick("2", "design", ds.forum.id)) {
    if (!rec.ok) continue;
    // 기록 당시 입력으로 검증한다(지난 실험 조건을 지금 입력과 섞지 않음). 입력 기록이 없을 때만 지금 입력을 쓴다
    const res = validateForumDesign(rec.raw, (rec.input as ForumDesignInput | undefined) ?? designInput(ds));
    out(`**설계 판정 (2차)**: 지금 판정 ${res.status}`);
    if (res.status === "invalid") continue;
    const llm: Record<string, CellJudgment> = {};
    for (const c of res.cells) if (c.issues.length === 0) llm[`${c.objectiveId}|${c.target}`] = c.judgment;
    const ex = exampleChecklist(ds, DATE).cells;
    const g = designGaps(ds, llm as Checklist);
    const eg = designGaps(ds, ex);
    const dd = diffChecklists(ds, ex, llm as Checklist);
    const o4req = ds.subQuestions.filter((q) => llm[`O4|${q.id}`] === "required").length;
    out(`- 설계 공백: 설계자 ${eg.uncoveredObjectives.join(", ") || "없음"} / LLM ${g.uncoveredObjectives.join(", ") || "없음"}`);
    out(`- 설계자 체크표와 다른 칸 ${dd.length}개: ${dd.map((d) => `${d.objectiveId}×${d.target === COMMON ? "공통" : d.target} ${d.a}→${d.b}`).join(", ") || "없음"}`);
    out(`- 역량 목표 O4를 필수로 둔 하위 논점 ${o4req}/${ds.subQuestions.length} (B0 §4: 공통 요건 이상만 Q 칸에 적는다 → 요구 구분 실패의 유력 사례)`);
    const o3q2 = res.cells.find((x) => x.objectiveId === "O3" && x.target === "Q2");
    if (ds.forum.id === "f5") out(`- 선정 사례 O3×Q2 (규칙: 필수, 설계자: 무관): LLM **${o3q2?.judgment ?? "?"}** — 규칙의 오류는 재현되지 않았지만 의도(무관)와도 다르다`);
    out();
    fsum.design = {
      status: res.status,
      gapsDesigner: eg.uncoveredObjectives,
      gapsLlm: g.uncoveredObjectives,
      diffCells: dd.length,
      o4RequiredQs: o4req,
      totalQs: ds.subQuestions.length,
      o3q2: ds.forum.id === "f5" ? (o3q2?.judgment ?? null) : null,
      seconds: secs(rec),
    };
  }

  const parts = pick("2", "profile", ds.forum.id);
  if (parts.length > 0 && parts.every((p) => p.rec.ok)) {
    const validated = parts.map((p) => validateForumProfile(p.rec.raw, p.rec.input as ForumProfileInput));
    if (validated.every((v) => v.status !== "invalid")) {
      const posts = validated.flatMap((v) => v.posts);
      const problems = validated.flatMap((v) => v.problems);
      const profile: ForumProfileResult = { status: problems.length ? "needs-review" : "valid", posts, problems };
      const input = profileInput(ds);
      const mock = validateForumProfile(forumProfileTask.mock(input), input);
      const review = profile.posts.filter((p) => p.issues.length > 0);
      const agreeP = profile.posts.filter((p) => p.primary === intent[p.postId]!.primary).length;
      const mockP = mock.posts.filter((p) => p.primary === intent[p.postId]!.primary).length;
      const agreeF = profile.posts.filter((p) => p.function === intent[p.postId]!.fn).length;
      out(`**글별 근거 (2차, 6개씩 ${parts.length}묶음, ${parts.map((p) => `${secs(p.rec)}초`).join(" · ")})**: 지금 판정 ${profile.status}`);
      out(`- 검토 필요(S6) 글 ${review.length}/${ds.posts.length}${review.length ? `: ${review.map((p) => `${p.postId}(${p.issues.join("; ")})`).join(" · ")}` : ""}`);
      out(`- 주 배정이 의도와 같음: LLM ${agreeP}/${ds.posts.length}, 규칙 ${mockP}/${ds.posts.length} · 기능: LLM ${agreeF}/${ds.posts.length} (순환·1회, 성능 근거 아님)`);
      out();
      out("선정한 규칙 실패 사례 (b0-prereg §9):");
      out();
      out("| 글 | 역할 | 의도 | 규칙 | LLM | 근거 검증 | LLM 근거 문장 |");
      out("|---|---|---|---|---|---|---|");
      const failRows = RULE_FAILURES[ds.forum.id]!.map((id) => {
        const l = profile.posts.find((p) => p.postId === id)!;
        const m = mock.posts.find((p) => p.postId === id)!;
        out(`| ${id} | ${intent[id]!.roles.join(", ") || "—"} | ${intent[id]!.primary} | ${m.primary} | **${l.primary}**${l.secondary.length ? ` (+${l.secondary.join(",")})` : ""} | ${l.issues.length ? "검토 필요" : "통과"} | ${(l.primaryQuote ?? "—").slice(0, 50)} |`);
        return { id, roles: intent[id]!.roles, intent: intent[id]!.primary, rule: m.primary, llm: l.primary, secondary: l.secondary, review: l.issues.length > 0, quote: l.primaryQuote };
      });
      out();
      const newFails = profile.posts.filter((p) => p.primary !== intent[p.postId]!.primary && !RULE_FAILURES[ds.forum.id]!.includes(p.postId));
      out(`선정 사례 밖 불일치 ${newFails.length}건${newFails.length ? " (참조 라벨의 적절성도 함께 따져 볼 것):" : ""}`);
      out();
      const newRows = newFails.map((p) => {
        const m = mock.posts.find((x) => x.postId === p.postId)!;
        out(`- ${p.postId}: 의도 ${intent[p.postId]!.primary} / LLM ${p.primary} / 규칙 ${m.primary}${m.primary === p.primary ? " (규칙도 같은 판정 → LLM만의 새 오류는 아님)" : ""} · 기능 ${RESPONSE_FUNCTION_LABEL[intent[p.postId]!.fn]}→${RESPONSE_FUNCTION_LABEL[p.function]}`);
        return { id: p.postId, intent: intent[p.postId]!.primary, llm: p.primary, rule: m.primary };
      });
      out();
      fsum.profile = {
        status: profile.status,
        batches: parts.map((p) => secs(p.rec)),
        review: review.map((p) => ({ id: p.postId, issues: p.issues })),
        agreePrimary: agreeP,
        agreeRule: mockP,
        agreeFunction: agreeF,
        total: ds.posts.length,
        ruleFailures: failRows,
        outside: newRows,
      };
    }
  }

  const comments: { run: string; recorded: string | null; result: ForumCommentResult; seconds: number; promptVersion: string | undefined; facts: ForumCommentInput["facts"] }[] = [];
  for (const run of ["2", "3", "4"]) {
    for (const { rec } of pick(run, "comment", ds.forum.id)) {
      if (!rec.ok) continue;
      const res = validateForumComment(rec.raw, rec.input as ForumCommentInput);
      comments.push({ run, recorded: rec.status ?? null, result: res, seconds: secs(rec), promptVersion: rec.promptVersion, facts: (rec.input as ForumCommentInput).facts });
      out(`**첨언 ${run}차** (${rec.promptVersion}, ${secs(rec)}초): 기록 당시 ${rec.status} (v${rec.validatorVersion}) / 지금 ${res.status}${res.problems.length ? ` — ${res.problems.join(" ")}` : ""}`);
      for (const [k, it] of res.items.entries()) out(`- ${k + 1}. (${it.focus}) 관찰: ${it.fields.observation} / 해석: ${it.fields.interpretation} / 질문: ${it.fields.question}`);
      out();
    }
  }
  fsum.comments = comments.map((c) => ({
    run: c.run,
    promptVersion: c.promptVersion,
    seconds: c.seconds,
    recorded: c.recorded,
    current: c.result.status,
    problems: c.result.problems,
    facts: c.facts.map((x) => ({ id: x.id, kind: x.kind, text: x.text })),
    items: c.result.items.map((it) => ({ focus: it.focus, fields: it.fields, issues: it.issues })),
  }));

  // 4차: 글별 근거 v3 (다른 묶음 부모 글 문맥) 한 묶음
  for (const { file, rec } of pick("4", "profile", ds.forum.id)) {
    const res = rec.ok ? validateForumProfile(rec.raw, rec.input as ForumProfileInput) : null;
    out(`**글별 근거 4차** (${rec.promptVersion}, ${file}): ${res ? `${secs(rec)}초 · 지금 판정 ${res.status}${res.problems.length ? ` — ${res.problems.join(" ")}` : ""}` : `실패 ${rec.error?.kind}`}`);
    if (res)
      for (const p of res.posts)
        out(`- ${p.postId}: ${p.primary} · 기능 ${RESPONSE_FUNCTION_LABEL[p.function]}${p.respondsTo ? `→${p.respondsTo}` : ""} (의도 ${intent[p.postId]!.primary} · ${RESPONSE_FUNCTION_LABEL[intent[p.postId]!.fn]})${p.issues.length ? ` · 검토 필요: ${p.issues.join("; ")}` : ""}`);
    out();
    fsum.profileV3 = res
      ? { status: res.status, seconds: secs(rec), posts: res.posts.map((p) => ({ id: p.postId, llm: p.primary, fn: p.function, intent: intent[p.postId]!.primary, intentFn: intent[p.postId]!.fn, review: p.issues.length > 0 })) }
      : { error: rec.error?.kind ?? "unknown" };
  }
}

writeFileSync(join(root, "docs", "forum-claim-map", "s5-lg-tables.md"), lines.join("\n") + "\n");
const summary = { model: MODEL, date: DATE, note: "합성 글 · 1회 실행 · temperature 0 · 추론 low. 의도 라벨과 같아도 성능 근거가 아니다.", calls, forums };
writeFileSync(join(root, "src", "data", "forum-live-lg.json"), JSON.stringify(summary, null, 2) + "\n");
console.log("wrote docs/forum-claim-map/s5-lg-tables.md, src/data/forum-live-lg.json");
