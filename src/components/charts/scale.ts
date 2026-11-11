// 순차 팔레트(파랑) 단계. 값이 클수록 진하다. 진한 단계에서는 흰 글자로 대비를 확보한다.
export const SEQ_STEPS = [
  { max: 0, bg: "var(--seq-0)", fg: "#1d2125" },
  { max: 0.2, bg: "var(--seq-1)", fg: "#1d2125" },
  { max: 0.35, bg: "var(--seq-2)", fg: "#1d2125" },
  { max: 0.5, bg: "var(--seq-3)", fg: "#0b0b0b" },
  { max: 0.65, bg: "var(--seq-4)", fg: "#0b0b0b" },
  { max: 0.8, bg: "var(--seq-5)", fg: "#ffffff" },
  { max: 1, bg: "var(--seq-6)", fg: "#ffffff" },
] as const;

export function seqColor(value: number): { bg: string; fg: string } {
  for (const s of SEQ_STEPS) if (value <= s.max + 1e-9) return { bg: s.bg, fg: s.fg };
  return SEQ_STEPS[SEQ_STEPS.length - 1]!;
}

export const SEQ_LEGEND = [
  { label: "0%", ...SEQ_STEPS[0] },
  { label: "~20", ...SEQ_STEPS[1] },
  { label: "~35", ...SEQ_STEPS[2] },
  { label: "~50", ...SEQ_STEPS[3] },
  { label: "~65", ...SEQ_STEPS[4] },
  { label: "~80", ...SEQ_STEPS[5] },
  { label: "~100", ...SEQ_STEPS[6] },
];
