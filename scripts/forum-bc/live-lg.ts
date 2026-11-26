// S5 LLM 부분 실연: LG EXAONE(k-exaone_v2.5)으로 토론 작업 3개를 과제별로 돌리고 원문을 저장한다.
// 실행: npm run forum:s5:live            1차 (작업 기본 설정, 글별 근거는 18개 한 번에)
//       npm run forum:s5:live -- --run2  2차 (계획 이탈: 출력 상한 16000, 글별 근거는 6개씩 나눠 요청)
// 저장: tests/fixtures/live/forum-<task>-<forumId>[-bN]-k-exaone_v2.5-<날짜>[-r2].json → npm run forum:s5 가 현재 검증기로 다시 검사한다.
// 입력은 합성 글뿐이다. 재시도 없음. 기준: docs/forum-claim-map/b0-prereg.md §9 (출력 보기 전에 고정).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTask } from "../../src/lib/ai/client";
import type { FetchLike } from "../../src/lib/ai/providers/http";
import type { AiTask } from "../../src/lib/ai/task";
import { forumCommentTask } from "../../src/lib/ai/tasks/forumComment";
import { forumDesignTask } from "../../src/lib/ai/tasks/forumDesign";
import { forumProfileTask, splitProfileInput, type ForumProfileInput, type ForumProfileResult } from "../../src/lib/ai/tasks/forumProfile";
import { aggregate, designGaps, isComplete, overlapCandidates } from "../../src/lib/forum/analysis";
import { FORUM_F5 } from "../../src/lib/forum/content/f5";
import { FORUM_LIT_F3 } from "../../src/lib/forum/content/litF3";
import { buildForumFacts } from "../../src/lib/forum/facts";
import { designInput, profileInput } from "../../src/lib/forum/inputs";
import { exampleChecklist, finalAssignments, sourceMix } from "../../src/lib/forum/state";
import type { ForumDataset } from "../../src/lib/forum/types";

const BASE = "https://api.exaone.ai/v1";
const MODEL = "k-exaone_v2.5";
const DATE = "2026-11-26";
const COMMENTS_V2 = process.argv.includes("--comments-v2");
/** 4차: 첨언 v3(관찰 = 사실 id 목록)와 글별 근거 v3(다른 묶음 부모 글 문맥) 형식 확인 */
const V3CHECK = process.argv.includes("--v3check");
const RUN2 = process.argv.includes("--run2") || COMMENTS_V2 || V3CHECK;
/** 저장 파일 꼬리표: 2차 "-r2", 첨언 3차 "-r3", 4차 "-r4" */
const SUFFIX = V3CHECK ? "-r4" : COMMENTS_V2 ? "-r3" : RUN2 ? "-r2" : "";
/** 2차: 추론 토큰이 상한에 들어가므로 넉넉히 둔다 */
const MAX_TOKENS_R2 = 16000;
const BATCH_R2 = 6;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "tests", "fixtures", "live");

const key = process.env.LG_API_KEY?.trim();
if (!key) {
  console.log("LG_API_KEY가 없습니다. 호출하지 않습니다.");
  process.exit(0);
}

let remaining: string | null = null;
/** LG 전용 요청 값(추론 low, temperature 0)을 넣고, 하루 남은 호출 수를 읽는다. 키는 기록하지 않는다 */
const lgFetch: FetchLike = async (input, init) => {
  let body = init?.body;
  if (typeof body === "string") {
    const j = JSON.parse(body) as Record<string, unknown>;
    body = JSON.stringify({ ...j, temperature: 0, reasoning_effort: "low" });
  }
  const res = await fetch(input, { ...init, body });
  remaining = res.headers.get("x-day-rate-limit-remaining") ?? remaining;
  return res;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withMax = <I, V>(task: AiTask<I, V>): AiTask<I, V> => (RUN2 ? { ...task, maxTokens: MAX_TOKENS_R2 } : task);

async function check(): Promise<boolean> {
  const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${key}` } });
  console.log(`models: HTTP ${res.status}`);
  return res.ok;
}

async function call<I, V>(baseTask: AiTask<I, V>, ds: ForumDataset, input: I, part = ""): Promise<V | null> {
  const task = withMax(baseTask);
  const started = Date.now();
  const rec: Record<string, unknown> = {
    task: task.id,
    forumId: ds.forum.id,
    run: V3CHECK ? 4 : COMMENTS_V2 ? 3 : RUN2 ? 2 : 1,
    part: part || null,
    dataVersion: ds.dataVersion,
    provider: "lg (OpenAI 호환, 스크립트 전용)",
    requestedModel: MODEL,
    request: { temperature: 0, reasoning_effort: "low", maxTokens: task.maxTokens },
    promptVersion: task.promptVersion,
    schemaVersion: task.schemaVersion,
    validatorVersion: task.validatorVersion,
    // 재생 테스트(tests/live-replay.test.ts)가 같은 입력으로 다시 검증한다
    input,
    createdAt: new Date().toISOString(),
  };
  const label = `${task.id} ${ds.forum.id}${part ? ` ${part}` : ""}`;
  try {
    const r = await runTask(task, input, {
      config: { provider: "openai", model: MODEL, baseUrl: BASE, apiKey: key },
      fetchImpl: lgFetch,
      timeoutMs: 300_000,
      retryFormat: false,
      pageProtocol: "https:",
    });
    const status = (r.result as { status?: string }).status;
    Object.assign(rec, { ok: true, responseModel: r.responseModel, usage: r.usage, durationMs: Date.now() - started, raw: r.raw, status });
    console.log(`${label}: ${status} (${Math.round((Date.now() - started) / 1000)}초, 남은 호출 ${remaining ?? "?"})`);
    return r.result;
  } catch (e) {
    const err = e as { kind?: string; message?: string; status?: number };
    Object.assign(rec, { ok: false, error: { kind: err.kind ?? "unknown", status: err.status ?? null, message: (err.message ?? "").slice(0, 200) }, durationMs: Date.now() - started });
    console.log(`${label}: 실패 ${err.kind ?? ""} ${err.status ?? ""}`);
    return null;
  } finally {
    mkdirSync(outDir, { recursive: true });
    const name = `forum-${task.id.replace("forum-", "")}-${ds.forum.id}${part ? `-${part}` : ""}-${MODEL}-${DATE}${SUFFIX}.json`;
    writeFileSync(join(outDir, name), JSON.stringify(rec, null, 2) + "\n");
    await sleep(1500);
  }
}

/** 2차: 글을 나눠 요청하고 검증 결과를 합친다. 한 묶음이라도 실패하면 null */
async function profileBatched(ds: ForumDataset, full: ForumProfileInput): Promise<ForumProfileResult | null> {
  const parts: ForumProfileResult[] = [];
  for (const [k, input] of splitProfileInput(full, BATCH_R2).entries()) {
    const r = await call(forumProfileTask, ds, input, `b${k + 1}`);
    if (!r || r.status === "invalid") return null;
    parts.push(r);
  }
  const posts = parts.flatMap((p) => p.posts);
  const problems = parts.flatMap((p) => p.problems);
  return { status: problems.length > 0 ? "needs-review" : "valid", posts, problems };
}

/**
 * 2차 미실행분: 요청 한도(429)로 실행되지 못한 호출만 다시 보낸다. 실패한 결과를 다시 뽑는 재시도가 아니다(b0-prereg §9).
 * 429 기록은 "-r2-429.json"으로 이름을 바꿔 남긴다. 첨언 입력은 저장한 2차 글별 근거 묶음으로 다시 만든다.
 */
async function resume(commentsOnly = false) {
  const { existsSync, readFileSync, renameSync } = await import("node:fs");
  const file = (task: string, ds: ForumDataset, part = "") => join(outDir, `forum-${task}-${ds.forum.id}${part ? `-${part}` : ""}-${MODEL}-${DATE}-r2.json`);
  const was429 = (f: string) => {
    if (!existsSync(f)) return false;
    const r = JSON.parse(readFileSync(f, "utf8")) as { ok: boolean; error?: { kind: string } };
    return !r.ok && r.error?.kind === "rate-limit";
  };
  for (const ds of [FORUM_F5, FORUM_LIT_F3]) {
    const df = file("design", ds);
    if (!commentsOnly && was429(df)) {
      renameSync(df, df.replace(/-r2\.json$/, "-r2-429.json"));
      await call(forumDesignTask, ds, designInput(ds));
    }
    const cf = file("comment", ds);
    if (commentsOnly || was429(cf)) {
      const parts: ForumProfileResult[] = [];
      for (let b = 1; existsSync(file("profile", ds, `b${b}`)); b++) {
        const r = JSON.parse(readFileSync(file("profile", ds, `b${b}`), "utf8")) as { ok: boolean; raw: unknown; input: ForumProfileInput };
        if (!r.ok) break;
        parts.push(forumProfileTask.validate(r.raw, r.input));
      }
      const profile = parts.length ? { posts: parts.flatMap((p) => p.posts) } : null;
      if (!profile || parts.some((p) => p.status === "invalid")) continue;
      if (!commentsOnly) renameSync(cf, cf.replace(/-r2\.json$/, "-r2-429.json"));
      const fin = finalAssignments(ds, profile.posts, {});
      const cl = exampleChecklist(ds, DATE).cells;
      const facts = buildForumFacts(ds, {
        agg: aggregate(ds, fin),
        source: sourceMix(fin),
        overlapPairs: overlapCandidates(ds).length,
        teacherGaps: isComplete(ds, cl) ? designGaps(ds, cl).uncoveredObjectives : null,
      });
      await call(forumCommentTask, ds, { forumId: ds.forum.id, facts });
    }
  }
  console.log(`끝. 남은 호출 ${remaining ?? "?"}`);
}

async function main() {
  if (V3CHECK) {
    if (!(await check())) return;
    await call(forumProfileTask, FORUM_F5, splitProfileInput(profileInput(FORUM_F5), BATCH_R2)[2]!, "b3");
    await resume(true);
    return;
  }
  if (COMMENTS_V2) {
    if (await check()) await resume(true);
    return;
  }
  if (process.argv.includes("--resume")) {
    if (await check()) await resume();
    return;
  }
  if (!(await check())) {
    console.log("LG 키가 거부되었습니다. 생성 호출을 하지 않습니다.");
    return;
  }
  for (const ds of [FORUM_F5, FORUM_LIT_F3]) {
    await call(forumDesignTask, ds, designInput(ds));
    const full = profileInput(ds);
    const profile = RUN2 ? await profileBatched(ds, full) : ((await call(forumProfileTask, ds, full)) as ForumProfileResult | null);
    if (!profile || profile.status === "invalid") continue;
    // 첨언은 LLM 배정(교수 확정 없음)과 설계자 예시 체크표로 만든 사실을 쓴다
    const fin = finalAssignments(ds, profile.posts, {});
    const cl = exampleChecklist(ds, DATE).cells;
    const facts = buildForumFacts(ds, {
      agg: aggregate(ds, fin),
      source: sourceMix(fin),
      overlapPairs: overlapCandidates(ds).length,
      teacherGaps: isComplete(ds, cl) ? designGaps(ds, cl).uncoveredObjectives : null,
    });
    await call(forumCommentTask, ds, { forumId: ds.forum.id, facts });
  }
  console.log(`끝. 남은 호출 ${remaining ?? "?"}`);
}

void main();
