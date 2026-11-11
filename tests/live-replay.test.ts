// 실연 응답 재생 테스트 (docs/decisions.md §8.7). npm run ai:smoke가 저장한 실제 모델 출력을
// 저장 당시 입력으로 다시 검증한다. 네트워크·키를 쓰지 않는다. 검증기를 바꿨을 때 실제 출력에서 회귀를 잡는다.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AiTask } from "@/lib/ai/task";
import { analysisSummaryTask } from "@/lib/ai/tasks/analysisSummary";
import { essayGradeTask } from "@/lib/ai/tasks/essayGrade";
import { relationDraftTask } from "@/lib/ai/tasks/relationDraft";
import { tagDraftTask } from "@/lib/ai/tasks/tagDraft";
import type { SuggestionStatus } from "@/lib/ai/types";

const TASKS: Record<string, AiTask<unknown, { status: SuggestionStatus }>> = {
  "essay-grade": essayGradeTask as unknown as AiTask<unknown, { status: SuggestionStatus }>,
  "tag-draft": tagDraftTask as unknown as AiTask<unknown, { status: SuggestionStatus }>,
  "relation-draft": relationDraftTask as unknown as AiTask<unknown, { status: SuggestionStatus }>,
  "analysis-summary": analysisSummaryTask as unknown as AiTask<unknown, { status: SuggestionStatus }>,
};

const dir = path.join(__dirname, "fixtures", "live");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("실연 응답 재생", () => {
  it("기록 파일이 있다", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s: 같은 검증기 버전이면 같은 상태가 나오고, 키 흔적이 없다", (file) => {
    const text = readFileSync(path.join(dir, file), "utf8");
    expect(text).not.toMatch(/AIza|AQ\.[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{10,}/);
    const rec = JSON.parse(text) as { task: string; validatorVersion: string; status: SuggestionStatus; input: unknown; raw: unknown };
    const task = TASKS[rec.task]!;
    expect(task).toBeDefined();
    const v = task.validate(rec.raw, rec.input);
    if (rec.validatorVersion === task.validatorVersion) expect(v.status).toBe(rec.status);
    else expect(v.status).not.toBe("invalid");
  });
});
