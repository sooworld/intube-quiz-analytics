// 답안 원문에 근거 인용 구간을 표시한다. 모델 출력은 HTML로 해석하지 않고 텍스트로만 렌더한다.
export interface Highlight {
  span: [number, number];
  /** 기준 순번(0부터) — 색 구분 */
  index: number;
  label: string;
}

/** active: 강조할 기준 순번. 정하면 다른 기준의 표시는 흐리게 한다 */
export function HighlightedEssay({ text, highlights, active = null }: { text: string; highlights: Highlight[]; active?: number | null }) {
  const cuts = new Set<number>([0, text.length]);
  for (const h of highlights) {
    cuts.add(Math.max(0, Math.min(text.length, h.span[0])));
    cuts.add(Math.max(0, Math.min(text.length, h.span[1])));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const parts: { from: number; to: number; hs: Highlight[] }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (from === to) continue;
    parts.push({ from, to, hs: highlights.filter((h) => h.span[0] <= from && h.span[1] >= to) });
  }
  return (
    <p className={`essay-text${active === null ? "" : " has-active"}`}>
      {parts.map((p) =>
        p.hs.length === 0 ? (
          <span key={p.from}>{text.slice(p.from, p.to)}</span>
        ) : (
          <mark key={p.from} className={`hl hl-${p.hs[0]!.index}${p.hs.some((h) => h.index === active) ? " is-active" : ""}`} title={p.hs.map((h) => h.label).join(" · ")}>
            {text.slice(p.from, p.to)}
          </mark>
        ),
      )}
    </p>
  );
}
