"use client";

import Link from "next/link";
import { useQuiz } from "@/lib/state/QuizContext";

/** Q-matrix를 수정했거나 저장 상태에 문제가 있을 때 알린다 */
export function QMatrixNotice() {
  const { isDefaultQ, qStatus, ds } = useQuiz();
  return (
    <>
      {!isDefaultQ ? (
        <div className="alert alert-warning" role="status">
          <p>
            이 브라우저에서 수정한 문제별 개념으로 계산한 결과입니다.{" "}
            <Link href={`/quiz/${ds.quiz.id}/qmatrix/`}>문제별 개념 확인·초기화</Link>
          </p>
        </div>
      ) : null}
      {qStatus === "discarded" ? (
        <div className="alert alert-warning" role="status">
          <p>저장된 문제별 개념이 손상되었거나 이전 데이터 버전이라 버리고 기본 태그를 사용합니다.</p>
        </div>
      ) : null}
      {qStatus === "session-only" ? (
        <div className="alert alert-warning" role="status">
          <p>브라우저 저장소를 쓸 수 없어, 수정 내용은 이번 세션에만 반영됩니다.</p>
        </div>
      ) : null}
    </>
  );
}
