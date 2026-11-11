// 정적 데이터 로더. 빌드 시점(Server Component)에서만 호출한다.
// 퀴즈 응답의 원천은 xAPI Statement 파일이고, QuizDataset은 변환기로 만든 파생값이다 (docs/xapi-plan.md).
import courseFile from "@/data/course.json";
import quizW5Def from "@/data/quiz-w5.json";
import quizW5e from "@/data/quiz-w5e.json";
import rosterFile from "@/data/roster.json";
import quizW5Statements from "../../public/xapi/quiz-w5.statements.json";
import type { Course, EssayQuizDataset, QuizDataset } from "./types";
import { toQuizDataset, type QuizDefinitionFile } from "./xapi/toDataset";
import type { XStatement } from "./xapi/vocab";

const quizW5 = toQuizDataset(
  quizW5Def as QuizDefinitionFile,
  rosterFile.students,
  quizW5Statements as unknown as XStatement[],
).dataset;

const datasets: Record<string, QuizDataset> = {
  [quizW5.quiz.id]: quizW5,
};

export function getCourse(): Course {
  return courseFile.course as Course;
}

export function quizIds(): string[] {
  return Object.keys(datasets);
}

export function getDataset(quizId: string): QuizDataset | null {
  return datasets[quizId] ?? null;
}

// 서술형 퀴즈는 0/1 퀴즈와 계약이 달라 레지스트리를 나눈다 (docs/decisions.md §6)
const essayDatasets: Record<string, EssayQuizDataset> = {
  [quizW5e.quiz.id]: quizW5e as unknown as EssayQuizDataset,
};

export function essayQuizIds(): string[] {
  return Object.keys(essayDatasets);
}

export function getEssayDataset(quizId: string): EssayQuizDataset | null {
  return essayDatasets[quizId] ?? null;
}

export const DEMO_DISCLAIMER =
  "이 데모는 Moodle 5.3 Boost 테마의 화면 구성을 참고한 비공식 데모이며 Moodle HQ와 관련이 없습니다. 모든 데이터는 가상입니다.";
