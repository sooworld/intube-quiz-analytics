// 근거 보기 (docs/xapi-plan.md §3.5). 화면 숫자를 만든 응답 칸마다 출처 Statement를 찾는다.
// 대응표(sources)는 변환기가 만든 것만 쓴다. 정오는 Statement의 result.success로 다시 나눈다.
import type { ItemId, QuizDataset, StudentId } from "../types";
import { sourceKey } from "./toDataset";
import type { XStatement } from "./vocab";

export interface EvidenceRow {
  studentId: StudentId;
  itemId: ItemId;
  attemptId: string;
  /** 무응답이면 null ("Statement 없음") */
  statement: XStatement | null;
}

export interface Evidence {
  correct: EvidenceRow[];
  incorrect: EvidenceRow[];
  missing: EvidenceRow[];
}

export interface EvidenceScope {
  itemIds: ItemId[];
  /** 없으면 응시 완료 학생 전체. 미응시 학생은 넣어도 빠진다 */
  studentIds?: StudentId[];
}

/** 응시 완료 학생 × 문항 칸을 정답·오답·Statement 없음으로 나눈다. 순서: 학생 id → scope의 문항 순서 */
export function collectEvidence(
  ds: Pick<QuizDataset, "attempts">,
  sources: Map<string, string>,
  statementsById: Map<string, XStatement>,
  scope: EvidenceScope,
): Evidence {
  const only = scope.studentIds ? new Set(scope.studentIds) : null;
  const attempts = ds.attempts
    .filter((a) => a.status === "finished" && (!only || only.has(a.studentId)))
    .sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));

  const ev: Evidence = { correct: [], incorrect: [], missing: [] };
  for (const a of attempts) {
    for (const itemId of scope.itemIds) {
      const sid = sources.get(sourceKey(a.id, itemId));
      const row: EvidenceRow = { studentId: a.studentId, itemId, attemptId: a.id, statement: null };
      if (!sid) {
        ev.missing.push(row);
        continue;
      }
      const s = statementsById.get(sid);
      if (!s) throw new Error(`대응표의 Statement ${sid}가 파일에 없다`);
      row.statement = s;
      (s.result?.success ? ev.correct : ev.incorrect).push(row);
    }
  }
  return ev;
}

export const evidenceTotal = (e: Evidence) => e.correct.length + e.incorrect.length + e.missing.length;

/** 화면 숫자의 분자. 정답률은 정답, 오답률은 오답 + 무응답 (matrix.ts isWrong과 같은 정의) */
export const evidenceNumerator = (e: Evidence, kind: "correct" | "wrong") =>
  kind === "correct" ? e.correct.length : e.incorrect.length + e.missing.length;
