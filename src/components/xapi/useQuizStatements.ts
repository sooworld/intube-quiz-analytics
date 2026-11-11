"use client";

import { useCallback, useMemo, useState } from "react";
import type { QuizDataset } from "@/lib/types";
import { loadedStatements, loadStatements } from "@/lib/xapi/load";
import { toQuizDataset } from "@/lib/xapi/toDataset";
import type { XStatement } from "@/lib/xapi/vocab";

export interface QuizStatements {
  statements: XStatement[];
  byId: Map<string, XStatement>;
  /** 변환기의 응답 → Statement 대응표. 근거는 이것만 읽는다 (docs/xapi-plan.md §1.2 원칙 3) */
  sources: Map<string, string>;
}

/** Statement 파일을 받아 분석과 같은 변환기로 대응표를 만든다. load()를 부를 때까지 받지 않는다 */
export function useQuizStatements(ds: QuizDataset) {
  const quizId = ds.quiz.id;
  const [statements, setStatements] = useState<XStatement[] | undefined>(() => loadedStatements(quizId));
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus("loading");
    loadStatements(quizId).then(
      (ss) => {
        setStatements(ss);
        setStatus("idle");
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      },
    );
  }, [quizId]);

  const data = useMemo<QuizStatements | null>(() => {
    if (!statements) return null;
    const { sources } = toQuizDataset({ dataVersion: ds.dataVersion, quiz: ds.quiz }, ds.students, statements);
    return { statements, byId: new Map(statements.map((s) => [s.id, s])), sources };
  }, [statements, ds]);

  return { data, status, error, load };
}
