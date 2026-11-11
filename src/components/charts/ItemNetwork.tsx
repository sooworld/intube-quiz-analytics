"use client";

import type { KeyboardEvent } from "react";
import type { NetworkEdge } from "@/lib/analysis/network";
import type { Concept, Item, QMatrix } from "@/lib/types";

// 개념 색은 고정 순서 (dataviz 기준 팔레트 1~4번). 노드에 문항 번호 글자를 함께 써서 색만으로 구분하지 않는다.
export const CONCEPT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

interface Props {
  items: Item[];
  concepts: Concept[];
  qmatrix: QMatrix;
  edges: NetworkEdge[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function ItemNetwork({ items, concepts, qmatrix, edges, selected, onSelect }: Props) {
  const size = 420;
  const cx = size / 2;
  const cy = size / 2;
  const R = 150;
  const conceptIdx = new Map(concepts.map((c, i) => [c.id, i]));
  // 첫 번째 태그 개념 순, 그다음 문항 번호 순으로 원 위에 배치 (결정적 배치, 무작위 force layout 미사용)
  const ordered = [...items].sort((a, b) => {
    const ca = conceptIdx.get(qmatrix[a.id]?.[0] ?? "") ?? 99;
    const cb = conceptIdx.get(qmatrix[b.id]?.[0] ?? "") ?? 99;
    return ca - cb || a.number - b.number;
  });
  const pos = new Map(
    ordered.map((it, i) => {
      const ang = (2 * Math.PI * i) / ordered.length - Math.PI / 2;
      return [it.id, { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang), ang }];
    }),
  );
  const isNeighbor = (id: string) => !!selected && edges.some((e) => (e.a === selected && e.b === id) || (e.b === selected && e.a === id));

  const onKey = (id: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(selected === id ? null : id);
    }
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }} role="group" aria-label="문제 관계도. 동그라미는 문항, 선은 기준 이상으로 비슷한 문항 쌍입니다. 옆 연결 목록 표에 같은 정보가 있습니다.">
      {edges.map((e) => {
        const a = pos.get(e.a)!;
        const b = pos.get(e.b)!;
        const active = !selected || e.a === selected || e.b === selected;
        const qa = items.find((i) => i.id === e.a)?.number;
        const qb = items.find((i) => i.id === e.b)?.number;
        return (
          <line
            key={e.a + e.b}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={active ? "var(--text-secondary)" : "var(--chart-grid)"}
            strokeWidth={1 + e.weight * 6}
            strokeLinecap="round"
            opacity={active ? 0.75 : 0.6}
          >
            <title>{`Q${qa}–Q${qb}: ${e.weight.toFixed(2)} (근거 ${e.support})`}</title>
          </line>
        );
      })}
      {ordered.map((it) => {
        const p = pos.get(it.id)!;
        const tags = qmatrix[it.id] ?? [];
        const color = tags.length ? CONCEPT_COLORS[(conceptIdx.get(tags[0]!) ?? 0) % CONCEPT_COLORS.length] : "#adb5bd";
        const isSel = selected === it.id;
        const dim = !!selected && !isSel && !isNeighbor(it.id);
        const lx = cx + (R + 34) * Math.cos(p.ang);
        const ly = cy + (R + 34) * Math.sin(p.ang);
        const degree = edges.filter((e) => e.a === it.id || e.b === it.id).length;
        return (
          <g
            key={it.id}
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            aria-label={`Q${it.number}, 개념 ${tags.map((t) => concepts.find((c) => c.id === t)?.name).join("·") || "없음"}, 연결 ${degree}개`}
            onClick={() => onSelect(isSel ? null : it.id)}
            onKeyDown={onKey(it.id)}
            style={{ cursor: "pointer", opacity: dim ? 0.35 : 1 }}
          >
            <circle cx={p.x} cy={p.y} r={isSel ? 21 : 18} fill={color} stroke="#fff" strokeWidth={2} />
            {tags.length > 1 ? <circle cx={p.x} cy={p.y} r={isSel ? 25 : 22} fill="none" stroke={CONCEPT_COLORS[(conceptIdx.get(tags[1]!) ?? 0) % CONCEPT_COLORS.length]} strokeWidth={3} strokeDasharray="4 3" /> : null}
            {isSel ? <circle cx={p.x} cy={p.y} r={29} fill="none" stroke="var(--text)" strokeWidth={2} /> : null}
            <text x={p.x} y={p.y + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: "#fff" }}>Q{it.number}</text>
            <text x={lx} y={ly + 4} textAnchor="middle" style={{ fontSize: 11, fill: "var(--text-secondary)" }}>{degree}개</text>
          </g>
        );
      })}
    </svg>
  );
}
