// 강의계획서(Syllabus) 데이터 계약 (docs/decisions.md U19). 강좌의 "무엇을 가르치는가"를 한곳에 둔다.
// 주차 제목·개념·목표 문구는 여기서 나오고, 퀴즈·서술형·토론은 항목 id로 가리킨다.
// 이 디렉터리는 순수 데이터·함수만 두고 상대 경로로만 import한다(tsx 생성 스크립트가 함께 읽는다).
import type { ConceptId } from "../types";

/** 강좌 전체(역량 목표 등) 또는 특정 주차(여러 주차 가능) */
export type SyllabusScope = { kind: "course" } | { kind: "weeks"; weeks: number[] };

/** 학습 개념(학습내용). 퀴즈 문항의 개념 태그와 서술형 루브릭 기준이 가리킨다 */
export interface SyllabusConcept {
  id: ConceptId;
  /** 배우는 주차. 평가 주차와 다를 수 있다(예: 4주차에 배우고 5주차 퀴즈에서 평가) */
  weeks: number[];
  /** 활동이 그대로 가져다 쓰는 이름 */
  name: string;
  /** 활동이 그대로 가져다 쓰는 한 줄 설명 */
  description: string;
  /** 학습내용 상세. 문장 단위로 쪼개 연관도 근거·AI 프롬프트·화면 설명에 쓴다 */
  detail: string;
}

/** 학습 목표(수행 목표). 토론의 목표가 가리킨다. 개념과 다대다로 잇는다 */
export interface SyllabusObjective {
  id: string;
  scope: SyllabusScope;
  /** 내용 목표는 K1(관련성), 역량 목표는 K2·K3(루브릭)로 잰다 (bc-methodology.md T1) */
  kind: "content" | "competency";
  /** 활동이 그대로 가져다 쓰는 한 문장 */
  text: string;
  detail: string;
  conceptIds: ConceptId[];
}

/** 주차 계획. week는 Course.sections[].number와 같다(General=0은 계획서에 두지 않는다) */
export interface SyllabusWeek {
  week: number;
  /** 섹션 제목 "n주차: " 뒤에 오는 주제 */
  topic: string;
  content: string;
  method: string;
}

export interface SyllabusEvaluation {
  name: string;
  /** 성적 반영 비율(%) */
  weight: number;
  /** 이 평가에 들어가는 강좌 활동 id */
  activityIds: string[];
}

export interface Syllabus {
  courseId: string;
  overview: string;
  weeks: SyllabusWeek[];
  objectives: SyllabusObjective[];
  concepts: SyllabusConcept[];
  evaluation: SyllabusEvaluation[];
  /** 이 계획서가 가상이라는 표시. 화면은 항상 이 문구를 보인다 */
  provenance: string;
}

/** 계획서 항목(개념 또는 목표). 화면 링크·연관도 근거가 가리키는 단위 */
export type SyllabusItem = ({ type: "concept" } & SyllabusConcept) | ({ type: "objective" } & SyllabusObjective);
