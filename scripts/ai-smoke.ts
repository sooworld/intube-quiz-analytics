// 실연 스크립트 (docs/decisions.md §8.1 U8, §8.7). 한 번 실행에 작업 1개, 생성 요청 정확히 1건(재시도 없음).
// 사용: npm run ai:smoke -- <essay|tag|relation|summary> [모델 id]
// 키는 .env의 GEMINI_API_KEY에서 읽고 화면·파일 어디에도 출력하지 않는다.
// 결과(검증 전 모델 출력 포함)는 tests/fixtures/live/에 저장해 재생 테스트로 다시 검증한다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDataset, getEssayDataset } from "../src/lib/data";
import { runTask, type TaskRun } from "../src/lib/ai/client";
import { geminiListModels } from "../src/lib/ai/providers/gemini";
import { redact } from "../src/lib/ai/providers/http";
import type { AiTask } from "../src/lib/ai/task";
import { analysisSummaryTask } from "../src/lib/ai/tasks/analysisSummary";
import { essayGradeTask } from "../src/lib/ai/tasks/essayGrade";
import { relationDraftInput, relationDraftTask } from "../src/lib/ai/tasks/relationDraft";
import { tagDraftInput, tagDraftTask } from "../src/lib/ai/tasks/tagDraft";
import { AiError, type ProviderConfig, type SuggestionStatus } from "../src/lib/ai/types";
import { buildAnalysisFacts } from "../src/lib/analysis/facts";
import { buildMatrix, defaultQMatrix } from "../src/lib/analysis/matrix";
import type { QuizDataset } from "../src/lib/types";

const GEMINI_MODEL: Record<string, string> = { essay: "gemini-3.5-flash-lite", tag: "gemini-3.5-flash-lite", relation: "gemini-3.5-flash-lite", summary: "gemini-3.5-flash" };
const KEY_ENV = "GEMINI_API_KEY";

const data: QuizDataset = getDataset("quiz-w5")!;
const q = defaultQMatrix(data.quiz.items);

function inputFor(kind: string): { task: AiTask<unknown, { status: SuggestionStatus; problems: string[] }>; input: unknown } {
  const cast = <I, V extends { status: SuggestionStatus; problems: string[] }>(task: AiTask<I, V>, input: I) => ({ task: task as unknown as AiTask<unknown, V>, input });
  if (kind === "essay") {
    // 서술형 문항 1의 첫 답안(무응답 제외)
    const essay = getEssayDataset("quiz-w5e")!;
    const item = essay.quiz.items[0]!;
    const sub = essay.submissions.find((s) => s.itemId === item.id && s.text !== null && s.text.trim() !== "")!;
    return cast(essayGradeTask, { item, essay: sub.text! });
  }
  if (kind === "tag") return cast(tagDraftTask, tagDraftInput(data.quiz.concepts, data.quiz.items));
  if (kind === "relation") return cast(relationDraftTask, relationDraftInput(data.quiz.concepts, data.quiz.items, q));
  if (kind === "summary") return cast(analysisSummaryTask, { facts: buildAnalysisFacts(buildMatrix(data), q, data.quiz.concepts, [], null) });
  throw new Error(`작업은 essay | tag | relation | summary 중 하나입니다: ${kind}`);
}

async function main() {
  const [kind = "", modelArg] = process.argv.slice(2);
  const { task, input } = inputFor(kind);
  const model = modelArg ?? GEMINI_MODEL[kind]!;
  const apiKey = process.env[KEY_ENV]?.trim() ?? "";
  if (!apiKey) throw new Error(`${KEY_ENV}가 없습니다(.env 확인).`);
  const fetchImpl = (u: string, i?: RequestInit) => fetch(u, i);
  const config: ProviderConfig = { provider: "gemini", model, apiKey };

  // 1) 모델 목록으로 키와 모델 id 확인 (생성 호출 아님, 하루 한도에 들지 않음)
  const models = await geminiListModels({ apiKey, fetchImpl });
  if (!models.includes(model)) throw new Error(`이 키로 쓸 수 없는 모델입니다: ${model}`);
  console.log(`[확인] 키 인증 통과, 모델 ${model} 사용 가능 (생성 지원 모델 ${models.length}개)`);

  // 2) 생성 요청 1건 (형식 오류 재시도 없음)
  const started = Date.now();
  let run: TaskRun<{ status: SuggestionStatus; problems: string[] }>;
  try {
    run = await runTask(task, input, { config, retryFormat: false, timeoutMs: 120_000 });
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError("network", String(err));
    console.error(`[실패] ${e.kind}${e.status ? ` (HTTP ${e.status})` : ""}: ${redact(e.message, apiKey)}`);
    process.exitCode = 1;
    return;
  }
  const ms = Date.now() - started;
  const usage = run.usage ? ` · 완성 토큰 ${run.usage.completionTokens ?? "?"} (추론 ${run.usage.reasoningTokens ?? "?"})` : "";
  console.log(`[결과] 작업 ${task.id} · 상태 ${run.result.status} · 요청 모델 ${run.requestedModel} · 응답 모델 ${run.responseModel ?? "알 수 없음"} · 호출 ${run.calls}회 · ${ms}ms${usage}`);
  for (const p of run.result.problems) console.log(`  - ${p}`);

  // 3) 기록 저장 (키 없음). 재생 테스트가 같은 입력으로 다시 검증한다
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(process.cwd(), "tests", "fixtures", "live");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${task.id}-${model}-${date}.json`);
  const record = {
    task: task.id,
    provider: run.provider,
    requestedModel: run.requestedModel,
    responseModel: run.responseModel,
    promptVersion: run.promptVersion,
    schemaVersion: run.schemaVersion,
    validatorVersion: run.validatorVersion,
    date,
    durationMs: ms,
    usage: run.usage,
    status: run.result.status,
    problems: run.result.problems,
    input,
    raw: run.raw,
  };
  const text = JSON.stringify(record, null, 2);
  if (text.includes(apiKey)) throw new Error("기록에 키가 들어 있어 저장하지 않습니다.");
  writeFileSync(file, text + "\n");
  console.log(`[저장] ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  const msg = redact(err instanceof Error ? err.message : String(err), process.env[KEY_ENV] ?? "");
  console.error(`[중단] ${msg}`);
  process.exitCode = 1;
});
