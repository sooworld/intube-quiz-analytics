// 토론(B 논증형 + C 해석형) 데이터 계약. 근거: docs/forum-claim-map/bc-methodology.md, b0-prereg.md.
// 이 디렉터리의 함수는 브라우저 API에 기대지 않는 순수 함수로 둔다(스크립트·테스트·화면이 함께 쓴다).

/** B = 논증형, C = 해석형(문학) */
export type ForumKind = "argument" | "interpretation";

export const FORUM_KIND_LABEL: Record<ForumKind, string> = {
  argument: "논증형 토론",
  interpretation: "해석형 토론 (문학)",
};

export interface ForumObjective {
  id: string;
  /** 내용 목표는 K1(관련성), 역량 목표는 K2·K3(루브릭)로 잰다 (T1) */
  kind: "content" | "competency";
  text: string;
  /** 이 목표를 꺼내 온 강의계획서 목표 id (src/lib/syllabus). AI 입력에는 넣지 않는다(designInput이 명시 투영) */
  syllabusId?: string;
}

export type Importance = "상" | "중" | "하";

export interface SubQuestion {
  id: string;
  text: string;
  /** 교수가 적는 수업상 중요도. 첨언은 이 값 없이 시간 재배분을 제안하지 않는다 (T2, Codex 3차 12) */
  importance: Importance;
  /** 예정 비중 (0~1) */
  plannedShare: number;
}

export interface ForumPost {
  id: string;
  author: string;
  /** null이면 과제 안내 글에 바로 단 글 */
  parentId: string | null;
  createdAt: string;
  text: string;
}

/** C형의 작품. 행 단위로 둔다(구절 인용 검사와 복수 구절 근거용) */
export interface ForumWork {
  title: string;
  author: string;
  source: string;
  stanzas: string[][];
}

/** 설계 지도 칸 판정. 필수 = 그 목표 없이는 Q에 충실히 답할 수 없음 (T3, 3차 6·7) */
export type CellJudgment = "required" | "optional" | "none";

export const CELL_LABEL: Record<CellJudgment, string> = { required: "필수", optional: "선택", none: "무관" };

/** "O1|Q2" 형태의 칸 키 */
export type CellKey = `${string}|${string}`;

export function cellKey(objectiveId: string, qId: string): CellKey {
  return `${objectiveId}|${qId}`;
}

export interface RubricCriterion {
  id: string;
  name: string;
  /** 화면 ⓘ에 보일 설명 */
  description: string;
}

/** Mock(규칙 기반, AI 아님)이 쓰는 단서. 데이터와 함께 두어 강좌마다 다르게 쓴다 */
export interface ForumMockCues {
  /** 주제와 이어지는지 볼 단어 (주제 이탈 판단) */
  topic: string[];
  /** 하위 논점별 단서 */
  questions: Record<string, string[]>;
  /** 목표별 단서. strong이 Q 문장(공통 열은 안내 글)에 있으면 필수, weak이면 선택으로 본다.
   *  목표 문장의 명사구를 기계적으로 옮긴 것이다(체크표에 맞춰 고르지 않음). 그래서 "관련"을 "요구"로 읽는 오류가 그대로 나온다 */
  objectives: Record<string, { strong: string[]; weak: string[] }>;
  /** 루브릭 기준별 단서 (문장 단위) */
  rubric: Record<string, string[]>;
}

export interface ForumDataset {
  dataVersion: string;
  forum: {
    id: string;
    courseId: string;
    sectionNumber: number;
    name: string;
    kind: ForumKind;
    /** 토론 주제 (한 문장) */
    topic: string;
    /** 교수가 올린 과제 안내 글 */
    intro: string;
    opensAt: string;
    closesAt: string;
  };
  objectives: ForumObjective[];
  subQuestions: SubQuestion[];
  work: ForumWork | null;
  posts: ForumPost[];
  rubric: RubricCriterion[];
  /** 안내 글(공통 제출 요건)이 모든 글·답글에 요구하는 목표. Q 칸과 따로 본다 (b0-prereg.md §4, Codex B0 검토 8) */
  commonRequirements: Partial<Record<string, CellJudgment>>;
  /** 설계자 예시 판단 (b0-prereg.md §4). 화면에서는 "예시로 채우기"로만 쓴다 */
  exampleChecklist: Partial<Record<CellKey, CellJudgment>>;
  mock: ForumMockCues;
  /** 이 데이터가 합성 글이라는 표시. 화면은 항상 이 문구를 보인다 */
  provenance: string;
}

/** 글 배정 값: Q id, 새 논점 후보, 주제 이탈, 판단 보류 */
export type AssignmentTarget = string | "new" | "off" | "hold";

export const SPECIAL_TARGET_LABEL: Record<"new" | "off" | "hold", string> = {
  new: "새 논점 후보",
  off: "주제 이탈",
  hold: "판단 보류",
};

/** K4 응답 기능 (b0-prereg.md §5) */
export const RESPONSE_FUNCTIONS = ["new-opinion", "agree-reason", "rebut", "question", "extend", "repeat", "sidestep"] as const;
export type ResponseFunction = (typeof RESPONSE_FUNCTIONS)[number];

export const RESPONSE_FUNCTION_LABEL: Record<ResponseFunction, string> = {
  "new-opinion": "새 의견",
  "agree-reason": "동의+근거",
  rebut: "반박",
  question: "질문",
  extend: "확장",
  repeat: "반복",
  sidestep: "비껴감",
};
