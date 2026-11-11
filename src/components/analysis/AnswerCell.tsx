import { misconceptionCandidate } from "@/lib/analysis/grading";
import type { GradedState, Item } from "@/lib/types";

const STATE_LABEL: Record<GradedState, string> = { correct: "정답", incorrect: "오답", unanswered: "무응답" };

/** 학생 답안 + 채점 + 오개념 후보 (표의 두 칸) */
export function AnswerCell({ item, raw, state }: { item: Item; raw: string | null; state: GradedState }) {
  const option = item.type === "mcq" && raw ? item.options?.find((o) => o.id === raw) : null;
  const candidate = state === "incorrect" ? misconceptionCandidate(item, raw) : null;
  return (
    <>
      <td>
        {raw === null ? (
          <span className="muted">(응답 없음)</span>
        ) : option ? (
          <>
            <span className="answer-chip">{option.id}</span> {option.text}
          </>
        ) : (
          <span className="answer-chip">{raw}</span>
        )}
        {state === "incorrect" ? (
          <div className="small muted">오개념 후보: {candidate ?? "미분류"}</div>
        ) : null}
      </td>
      <td className={`state-${state}`}>{STATE_LABEL[state]}</td>
    </>
  );
}
