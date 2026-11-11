// xAPI 어휘와 Statement 타입 (docs/xapi-profile.md). 생성기와 변환기가 함께 쓴다.
// IRI 기준 도메인은 **임시**다(docs/xapi-plan.md U2). 데이터 풀에 넣기 전에 확정하고 다시 생성한다.

export const IRI_BASE = "https://learnlens.example/xapi";

/** Statement 데이터 버전. 생성 규칙이나 값이 바뀌면 올린다 → id·registration 네임스페이스가 바뀐다 */
export const STATEMENT_DATA_VERSION = "2026-11-11.1";

export const PLATFORM = "LearnLens demo (synthetic)";

export const VERB = {
  attempted: "http://adlnet.gov/expapi/verbs/attempted",
  answered: "http://adlnet.gov/expapi/verbs/answered",
  completed: "http://adlnet.gov/expapi/verbs/completed",
  scored: "http://adlnet.gov/expapi/verbs/scored",
  voided: "http://adlnet.gov/expapi/verbs/voided",
} as const;

export const VERB_DISPLAY: Record<keyof typeof VERB, string> = {
  attempted: "응시 시작함",
  answered: "응답함",
  completed: "응시 완료함",
  scored: "점수 확정됨",
  voided: "무효화함",
};

export const ACTIVITY_TYPE = {
  course: "http://adlnet.gov/expapi/activities/course",
  assessment: "http://adlnet.gov/expapi/activities/assessment",
  interaction: "http://adlnet.gov/expapi/activities/cmi.interaction",
} as const;

export const EXT = {
  /** LMS의 응시 id. registration(UUID)에서 거꾸로 복원할 수 없으므로 그대로 둔다 */
  attemptId: `${IRI_BASE}/ext/attempt-id`,
} as const;

export const USERS_HOMEPAGE = `${IRI_BASE}/users`;
export const courseIri = (courseId: string) => `${IRI_BASE}/course/${courseId}`;
export const quizIri = (courseId: string, quizId: string) => `${courseIri(courseId)}/quiz/${quizId}`;
export const itemIri = (courseId: string, quizId: string, itemId: string) => `${quizIri(courseId, quizId)}/item/${itemId}`;

// ---- Statement 타입: 이 프로젝트가 만들고 읽는 범위만 ----

export type LangMap = Record<string, string>;

export interface XAgent {
  objectType?: "Agent";
  name?: string;
  account: { homePage: string; name: string };
}

export interface XActivityDefinition {
  name?: LangMap;
  description?: LangMap;
  type?: string;
  interactionType?: "choice" | "fill-in" | "long-fill-in" | "numeric";
  correctResponsesPattern?: string[];
  choices?: { id: string; description: LangMap }[];
}

export interface XActivity {
  objectType?: "Activity";
  id: string;
  definition?: XActivityDefinition;
}

export interface XStatementRef {
  objectType: "StatementRef";
  id: string;
}

export interface XResult {
  response?: string;
  success?: boolean;
  completion?: boolean;
  score?: { raw?: number; min?: number; max?: number; scaled?: number };
  duration?: string;
}

export interface XStatement {
  id: string;
  actor: XAgent;
  verb: { id: string; display?: LangMap };
  object: XActivity | XStatementRef;
  result?: XResult;
  context?: {
    registration?: string;
    platform?: string;
    instructor?: XAgent;
    contextActivities?: { parent?: XActivity[]; grouping?: XActivity[] };
    extensions?: Record<string, unknown>;
  };
  timestamp?: string;
  // LRS가 붙이는 값. 생성기는 넣지 않고 변환기는 무시한다
  stored?: string;
  authority?: unknown;
  version?: string;
}
