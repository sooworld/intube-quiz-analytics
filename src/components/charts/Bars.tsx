// 가로 막대: 0 기준선에서 시작, 값과 분모를 글자로 함께 표시 (색만으로 정보를 전달하지 않는다)
import type { ReactNode } from "react";

export function HBar({ label, value, color = "var(--series-1)", valueText, title }: {
  label: ReactNode;
  value: number | null;
  color?: string;
  valueText: string;
  title?: string;
}) {
  return (
    <li className="hbar-row" title={title}>
      <span className="hbar-label">{label}</span>
      <span className={`hbar-track${value === null ? " hatch" : ""}`} aria-hidden="true">
        {value !== null ? <span className="hbar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} /> : null}
      </span>
      <span className="hbar-value">{valueText}</span>
    </li>
  );
}

/** 학생 값(막대)과 학급 값(점선 표식)을 한 줄에 */
export function HBarCompare({ label, student, classValue, valueText, classText }: {
  label: ReactNode;
  student: number | null;
  classValue: number | null;
  valueText: string;
  classText: string;
}) {
  return (
    <li className="hbar-row">
      <span className="hbar-label">{label}</span>
      <span className={`hbar-track${student === null ? " hatch" : ""}`} aria-hidden="true">
        {student !== null ? <span className="hbar-fill" style={{ width: `${student * 100}%`, background: "var(--series-1)" }} /> : null}
        {classValue !== null ? <span className="class-marker" style={{ left: `${classValue * 100}%` }} /> : null}
      </span>
      <span className="hbar-value">
        {valueText}
        <br />
        <span className="muted small">학급 {classText}</span>
      </span>
    </li>
  );
}
