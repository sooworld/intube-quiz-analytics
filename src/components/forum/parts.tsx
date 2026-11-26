"use client";
// 토론 화면 공용 조각: 배정 이름, 도구 표지, 사실 토큰 문장, 강조 문장.
import { useState, type ReactNode } from "react";
import type { ForumFact } from "@/lib/forum/facts";
import { SPECIAL_TARGET_LABEL, type ForumDataset } from "@/lib/forum/types";

export function targetLabel(t: string): string {
  return t === "new" || t === "off" || t === "hold" ? SPECIAL_TARGET_LABEL[t] : t;
}

export function qText(ds: ForumDataset, id: string): string {
  return ds.subQuestions.find((q) => q.id === id)?.text ?? id;
}

/** 도구 결과의 출처 표지. Mock이면 "규칙 기반 예시 결과", 실제 모델이면 "AI 추정 · 미검증" (b0-prereg.md §0) */
export function ToolLabel({ provider, model }: { provider: string; model: string | null }) {
  if (provider === "mock") return <span className="badge badge-demo">규칙 기반 예시 결과 · 실제 LLM 미사용</span>;
  return <span className="badge badge-warn">AI 추정 · 미검증{model ? ` · ${model}` : ""}</span>;
}

/** 해석 칸 앞의 글자 표지 (색만으로 구분하지 않는다, T7) */
export function GuessMark({ provider }: { provider: string }) {
  return <span className="mark-guess">{provider === "mock" ? "규칙 기반 예시 해석 · 미검증" : "AI 추정 · 미검증"}</span>;
}

export function FactMark() {
  return <span className="mark-fact">사실</span>;
}

const TOKEN = /\{(F\d{2,})\}/g;

function FactChip({ fact }: { fact: ForumFact }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fact-chip" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="근거 보기">
        {fact.text}
      </button>
      {open ? <span className="fact-chip-body">근거 {fact.id} · 코드가 계산한 값</span> : null}
    </>
  );
}

/** {F03} 토큰을 사실 칩으로 바꿔 보여 준다 */
export function FactText({ text, facts }: { text: string; facts: ForumFact[] }) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push(<span key={`t${last}`}>{text.slice(last, m.index)}</span>);
    const f = byId.get(m[1]!);
    out.push(f ? <FactChip key={`f${m.index}`} fact={f} /> : <span key={`m${m.index}`} className="badge badge-danger">없는 사실 {m[1]}</span>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(<span key={`t${last}`}>{text.slice(last)}</span>);
  return <>{out}</>;
}

/** 사실 토큰을 사실 문장으로 바꾼 평문 (복사용, 표지 유지) */
export function factPlain(text: string, facts: ForumFact[]): string {
  const byId = new Map(facts.map((f) => [f.id, f]));
  return text.replace(TOKEN, (_, id: string) => byId.get(id)?.text ?? `{${id}}`);
}

/** 원문의 구간들을 강조해 보여 준다. 겹치면 앞 구간을 우선한다 */
export function Highlighted({ text, spans }: { text: string; spans: { span: [number, number]; cls: string; label: string }[] }) {
  const sorted = [...spans].sort((a, b) => a.span[0] - b.span[0]);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const s of sorted) {
    const [a, b] = s.span;
    if (a < pos) continue;
    if (a > pos) out.push(<span key={`p${pos}`}>{text.slice(pos, a)}</span>);
    out.push(
      <mark key={`m${a}`} className={`hl ${s.cls}`} title={s.label}>
        {text.slice(a, b)}
      </mark>,
    );
    pos = b;
  }
  if (pos < text.length) out.push(<span key={`p${pos}`}>{text.slice(pos)}</span>);
  return <>{out}</>;
}
