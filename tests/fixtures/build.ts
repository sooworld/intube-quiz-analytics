// 손계산 가능한 소형 검증 데이터 (T9). 시연 데이터와 분리한다.
import { gradeItem } from "@/lib/analysis/grading";
import type { Attempt, Concept, Item, QuizDataset, Response, Student } from "@/lib/types";

export const C: Concept[] = [
  { id: "a", name: "개념A", description: "" },
  { id: "b", name: "개념B", description: "" },
  { id: "z", name: "태그 없는 개념", description: "" },
];

/** 정답이 "A"인 객관식 문항 */
export function mcq(id: string, number: number, conceptIds: string[]): Item {
  return {
    id,
    number,
    type: "mcq",
    stem: id,
    conceptIds,
    options: [
      { id: "A", text: "정답" },
      { id: "B", text: "오답1", misconception: "오개념1" },
      { id: "C", text: "오답2", misconception: "오개념2" },
    ],
    correctOptionId: "A",
  };
}

/**
 * grid[학생][문항]: 1 = 정답("A"), 0 = 오답("B"), null = 무응답.
 * notAttempted에 든 학생 번호는 미응시로 만든다.
 */
export function dataset(items: Item[], grid: (0 | 1 | null)[][], opts: { notAttempted?: number[]; shuffle?: boolean } = {}): QuizDataset {
  let students: Student[] = grid.map((_, i) => ({ id: `s${i + 1}`, name: `학생${i + 1}` }));
  const attempts: Attempt[] = students.map((s, i) => ({
    id: `a${i + 1}`,
    studentId: s.id,
    status: opts.notAttempted?.includes(i) ? "notattempted" : "finished",
  }));
  const responses: Response[] = [];
  grid.forEach((row, i) => {
    if (attempts[i]!.status !== "finished") return;
    row.forEach((v, j) => {
      const item = items[j]!;
      const raw = v === null ? null : v === 1 ? "A" : "B";
      const gradedState = gradeItem(item, raw);
      responses.push({ attemptId: `a${i + 1}`, itemId: item.id, rawAnswer: raw, gradedState, score: gradedState === "correct" ? 1 : 0 });
    });
  });
  if (opts.shuffle) {
    students = [...students].reverse();
    responses.reverse();
    attempts.reverse();
  }
  return {
    dataVersion: "test",
    quiz: { id: "t", courseId: "c", sectionNumber: 1, name: "t", intro: "", closeDate: "2026-01-01", concepts: C, items },
    students,
    attempts,
    responses,
  };
}
