// 데이터 계약 (docs/decisions.md §2). 모든 화면과 분석 함수는 이 타입만 사용한다.

export type ConceptId = string;
export type ItemId = string;
export type StudentId = string;

export interface Concept {
  id: ConceptId;
  name: string;
  description: string;
}

export interface McqOption {
  id: string; // "A", "B", ...
  text: string;
  /** 오답 선택지가 가리키는 오개념 후보. 정답 선택지는 비워 둔다. */
  misconception?: string;
}

export interface MisconceptionRule {
  /** 정규화된 답안이 이 값 중 하나와 정확히 같으면 해당 오개념 후보로 묶는다. */
  equals?: string[];
  /** 정규화된 답안에 이 부분 문자열이 모두 들어 있으면 해당 오개념 후보로 묶는다. */
  includesAll?: string[];
  label: string;
}

export interface ShortAnswerSpec {
  policy: "text" | "numeric";
  /** text: 허용 답안(정규화 후 비교). numeric: 정답 수치를 문자열로. */
  accepted: string[];
  /** numeric 전용: 허용 절대 오차 */
  tolerance?: number;
  misconceptionRules?: MisconceptionRule[];
}

export interface Item {
  id: ItemId;
  number: number;
  type: "mcq" | "short";
  stem: string;
  conceptIds: ConceptId[];
  options?: McqOption[];
  correctOptionId?: string;
  shortAnswer?: ShortAnswerSpec;
}

export interface Student {
  id: StudentId;
  name: string;
}

export interface Attempt {
  id: string;
  studentId: StudentId;
  status: "finished" | "notattempted";
}

export type GradedState = "correct" | "incorrect" | "unanswered";

export interface Response {
  attemptId: string;
  itemId: ItemId;
  /** mcq: 선택지 id, short: 학생이 입력한 원문. 무응답이면 null. */
  rawAnswer: string | null;
  gradedState: GradedState;
  score: 0 | 1;
}

export interface Activity {
  id: string;
  type: "quiz" | "page" | "assign" | "forum" | "url";
  name: string;
  /** 데모에서 실제로 열리는 활동만 href를 갖는다 */
  href?: string;
}

export interface Section {
  number: number;
  title: string;
  summary?: string;
  activities: Activity[];
}

export interface Course {
  id: string;
  shortName: string;
  fullName: string;
  teacher: string;
  sections: Section[];
}

export interface Quiz {
  id: string;
  courseId: string;
  sectionNumber: number;
  name: string;
  intro: string;
  closeDate: string; // ISO
  concepts: Concept[];
  items: Item[];
}

export interface QuizDataset {
  dataVersion: string;
  quiz: Quiz;
  students: Student[];
  attempts: Attempt[];
  responses: Response[];
}

/** Q-matrix: 문항 id → 개념 id 목록 (0/1 행렬의 희소 표현) */
export type QMatrix = Record<ItemId, ConceptId[]>;

/** 분석 함수 공통 반환 형태 (T2): 값과 분모, 근거 문항을 함께 돌려준다. */
export interface Measure {
  /** 0~1. 분모가 0이면 null("자료 없음") */
  value: number | null;
  numerator: number;
  denominator: number;
  evidenceItemIds: ItemId[];
}

// ── 서술형(에세이) 퀴즈 (docs/decisions.md §6) ─────────────────────────────
// quiz-w5의 0/1 계약과 섞지 않는다. 서술형은 루브릭 기준별 0–2 수준으로 채점한다.

export type RubricLevel = 0 | 1 | 2;

export interface RubricLevelSpec {
  level: RubricLevel;
  label: string;
  descriptor: string;
}

export interface RubricCriterion {
  id: string;
  name: string;
  conceptIds: ConceptId[];
  levels: RubricLevelSpec[];
}

export interface EssayItem {
  id: ItemId;
  number: number;
  stem: string;
  /** 문항이 전제하는 자료 조건 (예: 변수 유형·스케일·군집 형태) */
  context?: string;
  rubric: RubricCriterion[];
  /** 기준 수 × 2 */
  maxScore: number;
  /** 글자 수 제한. 초과해도 감점하지 않고 플래그만 단다 */
  charLimit: number;
}

export interface EssaySubmission {
  attemptId: string;
  itemId: ItemId;
  /** 무응답이면 null */
  text: string | null;
}

export type CriterionLevels = Record<string, RubricLevel>;

export interface ReferenceGrade {
  attemptId: string;
  itemId: ItemId;
  levels: CriterionLevels;
  /** generated: 생성 규칙으로 만든 답안 · holdout: 문장 뱅크 밖에서 손으로 쓴 답안 */
  origin: "generated" | "holdout";
}

export interface EssayQuiz {
  id: string;
  courseId: string;
  sectionNumber: number;
  name: string;
  intro: string;
  closeDate: string;
  concepts: Concept[];
  items: EssayItem[];
}

export interface EssayQuizDataset {
  dataVersion: string;
  quiz: EssayQuiz;
  students: Student[];
  attempts: Attempt[];
  submissions: EssaySubmission[];
  /** 가상 교수의 기준 채점. 데모에서 AI 제안의 일치도를 재는 데만 쓴다 */
  referenceGrades: ReferenceGrade[];
}
