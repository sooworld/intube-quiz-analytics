// 토론 글 텍스트 도구: 문장 나누기, 인용 구간, 작품 구절 대조, 단서 찾기. 순수 함수.
import type { ForumWork } from "./types";

export interface Sentence {
  text: string;
  start: number;
  end: number;
}

/** 문장 단위로 나눈다(원문 위치 포함). 따옴표 안의 마침표에서는 자르지 않는다 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "“" || ch === "”") inDouble = ch === "“" ? true : ch === "”" ? false : !inDouble;
    if (!inDouble && /[.!?。]/.test(ch) && (i + 1 === text.length || /\s/.test(text[i + 1]!))) {
      push(start, i + 1);
      start = i + 1;
    }
  }
  push(start, text.length);
  return out;

  function push(s: number, e: number) {
    while (s < e && /\s/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e > s) out.push({ text: text.slice(s, e), start: s, end: e });
  }
}

export interface QuotedSpan {
  /** 따옴표 안 글자 */
  inner: string;
  /** 따옴표를 포함한 원문 구간 [start, end) */
  start: number;
  end: number;
  kind: "double" | "single";
}

/** 큰따옴표("…", “…”)와 작은따옴표('…', ‘…’) 안의 구간 */
export function quotedSpans(text: string): QuotedSpan[] {
  const out: QuotedSpan[] = [];
  const re = /"([^"]+)"|“([^”]+)”|'([^']+)'|‘([^’]+)’/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const inner = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    out.push({ inner, start: m.index, end: m.index + m[0].length, kind: m[1] !== undefined || m[2] !== undefined ? "double" : "single" });
  }
  return out;
}

/** 대조용 정규화: 유니코드 정규화, 따옴표 통일, 공백·줄바꿈·연 구분 기호(/)를 한 칸으로 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\s/]+/g, " ")
    .trim();
}

/** needle이 hay의 부분 문자열인지 (정규화 후) */
export function includesNormalized(hay: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  return n !== "" && normalizeForMatch(hay).includes(n);
}

/** 원문에서 needle의 구간 [start, end). 공백 차이는 허용하지 않고, 정확히 같은 첫 위치만 찾는다 */
export function findSpan(hay: string, needle: string): [number, number] | null {
  const n = needle.trim();
  if (n === "") return null;
  const i = hay.indexOf(n);
  return i < 0 ? null : [i, i + n.length];
}

/** 작품의 모든 행 */
export function workLines(work: ForumWork): string[] {
  return work.stanzas.flat();
}

/** 작품 전문을 한 줄로 (연·행 사이는 공백) */
export function workFlat(work: ForumWork): string {
  return normalizeForMatch(workLines(work).join(" "));
}

/**
 * 인용이 작품에 실제로 있는지. 여러 행에 걸친 인용("영변에 약산 / 진달래꽃")도 찾는다.
 * 어미 활용으로 짧게 자른 인용('-우리다', '고이')은 그대로 부분 문자열이면 있다고 본다.
 */
export function isInWork(quote: string, work: ForumWork): boolean {
  const q = normalizeForMatch(quote).replace(/^-/, "");
  return q !== "" && workFlat(work).includes(q);
}

/**
 * 작품 구절로 보이는 인용을 모아 작품에 있는지 본다.
 * - 큰따옴표 안은 모두 본다.
 * - 작은따옴표 안은 4글자 이상이고 작품과 두 글자 이상 어절을 하나라도 나누는 것만 본다.
 *   짧은 말이나 대사('난 괜찮아')는 강조·혼잣말일 수 있어 뺀다. 바꿔 쓴 구절('보내 드리겠다')은 여전히 걸린다(규칙의 한계).
 */
export function passageQuotes(text: string, work: ForumWork): { quote: string; inWork: boolean; start: number; end: number }[] {
  const flat = workFlat(work);
  const sharesWord = (s: string) =>
    normalizeForMatch(s)
      .split(" ")
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .some((w) => [...w].length >= 2 && flat.includes(w));
  return quotedSpans(text)
    .filter((q) => q.kind === "double" || ([...q.inner].length >= 4 && sharesWord(q.inner)))
    .map((q) => ({ quote: q.inner, inWork: isInWork(q.inner, work), start: q.start, end: q.end }));
}

/**
 * S4(표현 중복)의 "인용 제거" 조건: 큰따옴표 안 문장과 작품 행을 지운다 (b0-prereg.md §6).
 * 작품이 없으면 큰따옴표 안만 지운다.
 */
export function stripQuoted(text: string, work: ForumWork | null): string {
  let out = text.replace(/"[^"]*"|“[^”]*”/g, " ");
  if (work) {
    for (const line of workLines(work).sort((a, b) => b.length - a.length)) out = out.split(line).join(" ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** 단서 하나가 글에 있는지 (소문자·정규화 후 부분 문자열) */
export function hasCue(text: string, cue: string): boolean {
  return normalizeForMatch(text).toLowerCase().includes(normalizeForMatch(cue).toLowerCase());
}

/** 글에 들어 있는 단서 목록 */
export function cueHits(text: string, cues: string[]): string[] {
  return cues.filter((c) => hasCue(text, c));
}

/** 글자 수 (서로게이트 쌍을 한 글자로) */
export function charLength(s: string): number {
  return [...s].length;
}
