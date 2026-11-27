// 강의계획서 레지스트리. 새 강좌는 계획서를 여기에 등록한다(README "새 강좌 추가" 참고).
import { SYLLABUS_ALGO101 } from "./content/algo101";
import { SYLLABUS_LIT201 } from "./content/lit201";
import type { Syllabus } from "./types";

const SYLLABI: Record<string, Syllabus> = {
  [SYLLABUS_ALGO101.courseId]: SYLLABUS_ALGO101,
  [SYLLABUS_LIT201.courseId]: SYLLABUS_LIT201,
};

export function syllabusCourseIds(): string[] {
  return Object.keys(SYLLABI);
}

export function getSyllabus(courseId: string): Syllabus | null {
  return SYLLABI[courseId] ?? null;
}
