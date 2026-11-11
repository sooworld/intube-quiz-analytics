// 서술형 채점 제안 작업 (docs/decisions.md §6). 프롬프트·스키마는 prompt.ts, 검증은 validate.ts에 있다.
import type { EssayItem } from "../../types";
import { buildGradingPrompt, gradingJsonSchema, PROMPT_VERSION, SCHEMA_VERSION } from "../prompt";
import { mockSuggest } from "../providers/mock";
import type { AiTask } from "../task";
import type { ValidatedSuggestion } from "../types";
import { validateSuggestion, VALIDATOR_VERSION } from "../validate";

export interface EssayGradeInput {
  item: EssayItem;
  /** 무응답은 작업을 부르기 전에 걸러낸다(client.requestSuggestion) */
  essay: string;
}

export const essayGradeTask: AiTask<EssayGradeInput, ValidatedSuggestion> = {
  id: "essay-grade",
  promptVersion: PROMPT_VERSION,
  schemaVersion: SCHEMA_VERSION,
  validatorVersion: VALIDATOR_VERSION,
  schemaName: "essay_grading",
  maxTokens: 4096,
  buildPrompt: ({ item, essay }) => buildGradingPrompt(item, essay),
  schema: ({ item }) => gradingJsonSchema(item),
  validate: (raw, { item, essay }) => validateSuggestion(raw, item, essay),
  mock: ({ item, essay }) => mockSuggest(item, essay),
};
