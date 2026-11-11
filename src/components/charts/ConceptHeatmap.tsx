"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import type { ConceptTable } from "@/lib/analysis/concepts";
import { pct } from "@/lib/format";
import type { Measure, Student } from "@/lib/types";
import { SEQ_LEGEND, seqColor } from "./scale";

export interface HeatmapSelection {
  /** "class" = 학급 전체 행 */
  rowId: string;
  conceptId: string;
}

interface Props {
  table: ConceptTable;
  studentById: Map<string, Student>;
  quizId: string;
  selected: HeatmapSelection | null;
  onSelect: (s: HeatmapSelection) => void;
  /** 행 순서 (학생 id). 학급 행은 항상 맨 위에 고정 */
  rowOrder: string[];
}

/**
 * 학생 칸은 분수만 쓴다(decisions §4 표시 문구 "2/3 문항 오답"). 개념당 문항이 몇 개뿐이라 백분율은 같은 정보이고
 * 색이 비율을 이미 보여 준다. 학급 행은 분모가 커서 백분율과 분수를 함께 쓴다(decisions U13).
 */
function Cell({ m, label, withPct, pressed, tabIndex, onClick, onKeyDown, refCb }: {
  m: Measure; label: string; withPct: boolean; pressed: boolean; tabIndex: number;
  onClick: () => void; onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void; refCb: (el: HTMLButtonElement | null) => void;
}) {
  const noData = m.value === null;
  const c = noData ? null : seqColor(m.value!);
  const text = noData ? "자료 없음" : `${m.denominator}문항 중 ${m.numerator}문항 오답, ${pct(m.value)}`;
  return (
    <button
      ref={refCb}
      type="button"
      className={`hm-cell${withPct ? "" : " single"}${noData ? " hatch" : ""}${m.value === 0 ? " zero" : ""}`}
      style={c ? { background: c.bg, color: c.fg } : undefined}
      aria-pressed={pressed}
      aria-label={`${label}: ${text}`}
      title={`${label}\n${text}`}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {withPct ? <span className="v">{noData ? "–" : pct(m.value)}</span> : null}
      <span className={withPct ? "f" : "v"}>{noData ? "–" : `${m.numerator}/${m.denominator}`}</span>
    </button>
  );
}

export function ConceptHeatmap({ table, studentById, quizId, selected, onSelect, rowOrder }: Props) {
  const rows = ["class", ...rowOrder];
  const cols = table.concepts.map((c) => c.id);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const rowCells = new Map(table.rows.map((r) => [r.studentId, r.cells]));

  const move = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const nc = Math.max(0, Math.min(cols.length - 1, c));
    setFocus({ r: nr, c: nc });
    refs.current.get(`${nr}:${nc}`)?.focus();
  };

  const onKeyDown = (r: number, c: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const map: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1],
      Home: [r, 0], End: [r, cols.length - 1],
    };
    const t = map[e.key];
    if (t) {
      e.preventDefault();
      move(t[0], t[1]);
    }
  };

  return (
    <div>
      <div className="legend" aria-hidden="true">
        <span>오답률</span>
        <span className="legend-scale">
          {SEQ_LEGEND.map((s) => (
            <span key={s.label} style={{ background: s.bg, color: s.fg, boxShadow: s.label === "0%" ? "inset 0 0 0 1px var(--border)" : undefined }}>{s.label}</span>
          ))}
        </span>
        <span><span className="legend-swatch hatch" />자료 없음</span>
      </div>
      <div className="table-wrap" style={{ border: 0 }}>
        <table className="heatmap">
          <caption className="visually-hidden">학생별 개념 오답률. 첫 행은 학급 전체입니다.</caption>
          <thead>
            <tr>
              <th scope="col">학생</th>
              {table.concepts.map((c) => (
                <th key={c.id} scope="col">{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((rowId, r) => {
              const isClass = rowId === "class";
              const cells = isClass ? table.classRow : rowCells.get(rowId)!;
              const name = isClass ? "학급 전체" : studentById.get(rowId)?.name ?? rowId;
              return (
                <tr key={rowId} className={isClass ? "class-row" : undefined}>
                  <th scope="row" className="hm-row-head">
                    {isClass ? <strong>학급 전체</strong> : <Link href={`/quiz/${quizId}/student/${rowId}/`}>{name}</Link>}
                  </th>
                  {cols.map((cid, c) => (
                    <td key={cid}>
                      <Cell
                        m={cells[cid]!}
                        label={`${name}, ${table.concepts[c]!.name}`}
                        withPct={isClass}
                        pressed={selected?.rowId === rowId && selected.conceptId === cid}
                        tabIndex={focus.r === r && focus.c === c ? 0 : -1}
                        refCb={(el) => {
                          if (el) refs.current.set(`${r}:${c}`, el);
                          else refs.current.delete(`${r}:${c}`);
                        }}
                        onClick={() => {
                          setFocus({ r, c });
                          onSelect({ rowId, conceptId: cid });
                        }}
                        onKeyDown={onKeyDown(r, c)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
