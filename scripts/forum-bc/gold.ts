// 설계자 의도 라벨 (docs/forum-claim-map/b0-prereg.md §5). 정답이 아니라 "이렇게 쓰려고 했다"는 참조 라벨이다.
// 화면 코드(src/)에서 가져다 쓰지 않는다. B2 실행 스크립트와 테스트만 읽는다.
// 순서: B형 라벨은 B형 글을 쓴 직후, C형 라벨은 C형 글을 쓰기 전에 적었다(b0-prereg.md §5 순서 기록).
import type { ResponseFunction } from "../../src/lib/forum/types";

export interface PostIntent {
  /** 주 배정: Q id | new | off | hold */
  primary: string;
  /** 부 배정 (근거 구간이 있는 다른 Q) */
  secondary: string[];
  fn: ResponseFunction;
  /** 일부러 넣은 사례 역할 */
  roles: string[];
}

export type PairType = "copy" | "partial-copy" | "same-quote-independent" | "same-quote-opposite";

export interface PairIntent {
  a: string;
  b: string;
  type: PairType;
}

export const INTENT: Record<string, Record<string, PostIntent>> = {
  f5: {
    b01: { primary: "Q2", secondary: [], fn: "new-opinion", roles: ["long-essay"] },
    b02: { primary: "Q2", secondary: [], fn: "rebut", roles: ["different-vocab-rebuttal"] },
    b03: { primary: "Q1", secondary: [], fn: "new-opinion", roles: ["technical"] },
    b04: { primary: "Q1", secondary: [], fn: "new-opinion", roles: ["everyday-example"] },
    b05: { primary: "Q4", secondary: ["Q1"], fn: "extend", roles: ["two-q"] },
    b06: { primary: "Q4", secondary: [], fn: "new-opinion", roles: ["english-terms"] },
    b07: { primary: "Q3", secondary: ["Q2"], fn: "new-opinion", roles: ["two-q"] },
    b08: { primary: "Q3", secondary: [], fn: "agree-reason", roles: [] },
    b09: { primary: "Q2", secondary: [], fn: "repeat", roles: ["copy"] },
    b10: { primary: "Q2", secondary: [], fn: "new-opinion", roles: ["short"] },
    b11: { primary: "Q2", secondary: [], fn: "question", roles: [] },
    b12: { primary: "new", secondary: [], fn: "new-opinion", roles: ["extension"] },
    b13: { primary: "off", secondary: [], fn: "sidestep", roles: [] },
    b14: { primary: "off", secondary: [], fn: "new-opinion", roles: ["off-topic"] },
    b15: { primary: "hold", secondary: [], fn: "new-opinion", roles: ["vague"] },
    b16: { primary: "Q2", secondary: ["Q1"], fn: "new-opinion", roles: ["injection", "two-q"] },
    b17: { primary: "Q1", secondary: [], fn: "rebut", roles: ["different-vocab-rebuttal"] },
    b18: { primary: "Q2", secondary: [], fn: "extend", roles: [] },
  },
  "lit-f3": {
    c01: { primary: "Q1", secondary: [], fn: "new-opinion", roles: ["long-essay"] },
    c02: { primary: "Q1", secondary: [], fn: "rebut", roles: ["different-vocab-rebuttal"] },
    c03: { primary: "Q2", secondary: [], fn: "new-opinion", roles: [] },
    c04: { primary: "Q2", secondary: [], fn: "rebut", roles: [] },
    c05: { primary: "Q3", secondary: ["Q1"], fn: "new-opinion", roles: ["multi-passage", "two-q"] },
    c06: { primary: "Q1", secondary: [], fn: "new-opinion", roles: ["everyday-example"] },
    c07: { primary: "Q1", secondary: [], fn: "repeat", roles: ["partial-copy"] },
    c08: { primary: "Q1", secondary: [], fn: "new-opinion", roles: ["misquote"] },
    c09: { primary: "new", secondary: [], fn: "new-opinion", roles: ["extension", "context"] },
    c10: { primary: "hold", secondary: [], fn: "question", roles: [] },
    c11: { primary: "new", secondary: [], fn: "new-opinion", roles: ["q-decomposition-gap"] },
    c12: { primary: "hold", secondary: [], fn: "new-opinion", roles: ["reflection"] },
    c13: { primary: "Q4", secondary: ["Q1"], fn: "rebut", roles: ["two-q"] },
    c14: { primary: "Q2", secondary: [], fn: "agree-reason", roles: ["short"] },
    c15: { primary: "Q1", secondary: [], fn: "new-opinion", roles: ["english-terms"] },
    c16: { primary: "Q3", secondary: [], fn: "new-opinion", roles: ["injection"] },
    c17: { primary: "Q3", secondary: [], fn: "rebut", roles: ["same-quote"] },
    c18: { primary: "off", secondary: [], fn: "new-opinion", roles: ["off-topic"] },
  },
};

export const PAIRS: Record<string, PairIntent[]> = {
  f5: [
    { a: "b01", b: "b09", type: "copy" },
    { a: "b02", b: "b18", type: "same-quote-independent" },
  ],
  "lit-f3": [
    { a: "c01", b: "c07", type: "partial-copy" },
    { a: "c01", b: "c02", type: "same-quote-opposite" },
    { a: "c05", b: "c17", type: "same-quote-opposite" },
    { a: "c03", b: "c14", type: "same-quote-independent" },
  ],
};
