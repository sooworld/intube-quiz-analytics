"use client";
// 서술형 채점 대기열: 상태 필터와 학생 목록. 지금 보는 답안은 필터에 걸려도 선택을 유지하고 위에 따로 보여 준다.
// 상태는 손이 가야 하는 것(검토 필요·검증 실패)만 글자로 쓰고, 평소 상태는 점으로 둔다(decisions U13).
import { filterQueue, QUEUE_FILTERS, type QueueCounts, type QueueFilter, type RowStatus } from "@/lib/essay/queue";

export const STATUS_TEXT: Record<RowStatus, string> = { final: "확정", review: "검토 필요", invalid: "검증 실패", suggested: "제안 있음", none: "미제안" };

function StatusMark({ status }: { status: RowStatus }) {
  if (status === "review") return <span className="badge badge-warn">{STATUS_TEXT.review}</span>;
  if (status === "invalid") return <span className="badge badge-danger">{STATUS_TEXT.invalid}</span>;
  if (status === "none") return <span className="visually-hidden">{STATUS_TEXT.none}</span>;
  return (
    <span className={`gw-dot dot-${status}`} title={STATUS_TEXT[status]}>
      <span className="visually-hidden">{STATUS_TEXT[status]}</span>
    </span>
  );
}

/** 상태별 건수를 막대 하나로 보여 준다(확정·제안 있음·검토 필요, 빈 곳은 미제안). 건수는 마우스를 올리거나 스크린리더로 읽는다 */
export function QueueStatusBar({ counts }: { counts: QueueCounts }) {
  const segments = [
    { id: "final", label: STATUS_TEXT.final, n: counts.final },
    { id: "suggested", label: STATUS_TEXT.suggested, n: counts.suggested },
    { id: "attention", label: STATUS_TEXT.review, n: counts.attention },
  ];
  const label = [...segments, { id: "none", label: STATUS_TEXT.none, n: counts.none }].map((s) => `${s.label} ${s.n}`).join(" · ");
  return (
    <div className="gw-statusbar" role="img" aria-label={label} title={label}>
      {segments.map((s) => (s.n ? <span key={s.id} className={`gw-seg seg-${s.id}`} style={{ width: `${(s.n / (counts.all || 1)) * 100}%` }} /> : null))}
    </div>
  );
}

export interface QueueRow {
  key: string;
  name: string;
  status: RowStatus;
  empty: boolean;
  /** 유효한 최신 제안 총점 */
  aiTotal: number | null;
  finalTotal: number | null;
  /** 일괄 제안이 지금 이 답안을 처리 중 */
  inProgress: boolean;
}

export function GradingQueue(props: {
  itemNumber: number;
  rows: QueueRow[];
  counts: QueueCounts;
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const { visible, hiddenSelected } = filterQueue(props.rows, props.filter, props.selectedKey);
  return (
    <section className="card gw-queue" aria-labelledby="gw-queue-title">
      <h2 className="card-title" id="gw-queue-title">
        대기열
      </h2>
      <div className="gw-filters" role="group" aria-label="상태 필터">
        {QUEUE_FILTERS.map((f) => (
          <button key={f.id} type="button" className="gw-chip" aria-pressed={props.filter === f.id} onClick={() => props.onFilter(f.id)}>
            {f.label} {props.counts[f.id]}
          </button>
        ))}
      </div>
      {hiddenSelected ? (
        <p className="gw-hidden-row small" role="status">
          지금 보는 답안: <strong>{hiddenSelected.name}</strong> ({STATUS_TEXT[hiddenSelected.status]}, 필터에서 숨김)
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="muted small">이 필터에 해당하는 답안이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="data compact">
            <caption className="visually-hidden">문항 {props.itemNumber} 제출 목록</caption>
            <thead>
              <tr>
                <th scope="col">학생</th>
                <th scope="col">상태</th>
                <th scope="col" className="num">AI</th>
                <th scope="col" className="num">확정</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.key} className={r.key === props.selectedKey ? "is-selected" : undefined}>
                  <td>
                    <button type="button" className="btn-link" aria-current={r.key === props.selectedKey ? "true" : undefined} onClick={() => props.onSelect(r.key)}>
                      {r.name}
                    </button>
                    {r.empty ? <span className="small muted"> (무응답)</span> : null}
                  </td>
                  <td>{r.inProgress ? <span className="badge badge-info">제안 중…</span> : <StatusMark status={r.status} />}</td>
                  <td className="num">{r.aiTotal}</td>
                  <td className="num">{r.finalTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
