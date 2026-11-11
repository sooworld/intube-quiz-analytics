import { describe, expect, it } from "vitest";
import { getDataset } from "@/lib/data";
import { buildMatrix, defaultQMatrix } from "@/lib/analysis/matrix";
import { conceptContrast, looContrast, pairKind, pairTable, phiMatrix, scoreRows, sharedTags, tagContrast } from "@/lib/analysis/tagFit";
import { C, dataset, mcq } from "./fixtures/build";

// i1,i2 → 개념 a / i3,i4 → 개념 b
const items = [mcq("i1", 1, ["a"]), mcq("i2", 2, ["a"]), mcq("i3", 3, ["b"]), mcq("i4", 4, ["b"])];
// i1 = i2 = [1,1,0,0], i3 = i4 = [1,0,1,0] → 같은 태그 쌍 phi 1, 다른 태그 쌍 phi 0
const grid: (0 | 1 | null)[][] = [
  [1, 1, 1, 1],
  [1, 1, 0, 0],
  [0, 0, 1, 1],
  [0, 0, 0, 0],
];
const m = buildMatrix(dataset(items, grid));
const q = defaultQMatrix(items);

describe("공유 태그 묶음 phi (손계산)", () => {
  it("phi 행렬", () => {
    const phi = phiMatrix(m);
    expect(phi[0]![1]).toBeCloseTo(1, 10);
    expect(phi[2]![3]).toBeCloseTo(1, 10);
    expect(phi[0]![2]).toBeCloseTo(0, 10);
    expect(phi[1]![3]).toBeCloseTo(0, 10);
    expect(phi[0]![0]).toBeNull();
  });
  it("묶음 평균과 차이", () => {
    const t = tagContrast(phiMatrix(m), m.items, q);
    expect(t.shared).toEqual({ mean: expect.closeTo(1, 10), valid: 2, total: 2 });
    expect(t.other).toEqual({ mean: expect.closeTo(0, 10), valid: 4, total: 4 });
    expect(t.untaggedPairs).toBe(0);
    expect(t.diff).toBeCloseTo(1, 10);
  });
  it("학생 1명 제외 범위: s1·s4 제외 → 다른 태그 쌍 −0.5, s2·s3 제외 → +0.5", () => {
    const r = looContrast(m, q);
    expect(r.valid).toBe(4);
    expect(r.total).toBe(4);
    expect(r.min).toBeCloseTo(0.5, 10);
    expect(r.max).toBeCloseTo(1.5, 10);
  });
  it("개념별: 내부 쌍과 공유 태그 없는 문항과의 쌍. 태그 문항이 없는 개념은 자료 없음", () => {
    const rows = conceptContrast(phiMatrix(m), m.items, q, C);
    const a = rows.find((r) => r.conceptId === "a")!;
    expect(a.itemCount).toBe(2);
    expect(a.within).toEqual({ mean: expect.closeTo(1, 10), valid: 1, total: 1 });
    expect(a.outside).toEqual({ mean: expect.closeTo(0, 10), valid: 4, total: 4 });
    const z = rows.find((r) => r.conceptId === "z")!;
    expect(z).toEqual({ conceptId: "z", itemCount: 0, within: { mean: null, valid: 0, total: 0 }, outside: { mean: null, valid: 0, total: 0 } });
  });
});

describe("경계 조건", () => {
  it("분산 0 문항이 낀 쌍은 계산 불가로 세고 평균에서 뺀다", () => {
    const its = [...items, mcq("i5", 5, ["a"])];
    const mm = buildMatrix(dataset(its, grid.map((r) => [...r, 1] as (0 | 1)[])));
    const t = tagContrast(phiMatrix(mm), mm.items, defaultQMatrix(its));
    expect(t.shared).toEqual({ mean: expect.closeTo(1, 10), valid: 2, total: 4 });
    expect(t.other).toEqual({ mean: expect.closeTo(0, 10), valid: 4, total: 6 });
    // 계산 불가 쌍은 고정 집합에서 빠지므로 반복은 모두 유효
    expect(looContrast(mm, defaultQMatrix(its)).valid).toBe(4);
  });
  it("다중 태그로 하나라도 공유하면 공유 태그 있음", () => {
    const q2 = { ...q, i1: ["a", "b"] };
    expect(sharedTags("i1", "i3", q2)).toEqual(["b"]);
    expect(pairKind("i1", "i3", q2)).toBe("shared");
  });
  it("태그 없는 문항이 낀 쌍은 별도 집계", () => {
    const t = tagContrast(phiMatrix(m), m.items, { ...q, i4: [] });
    expect(t.untaggedPairs).toBe(3);
    expect(t.shared.total).toBe(1);
    expect(t.other.total).toBe(2);
  });
  it("모든 태그를 지우면 차이와 제외 범위는 계산 불가", () => {
    const empty = { i1: [], i2: [], i3: [], i4: [] };
    expect(tagContrast(phiMatrix(m), m.items, empty).diff).toBeNull();
    expect(looContrast(m, empty)).toEqual({ min: null, max: null, valid: 0, total: 4 });
  });
  it("모든 문항에 같은 태그면 공유 태그 없음 묶음이 비어 차이는 계산 불가", () => {
    const same = { i1: ["a"], i2: ["a"], i3: ["a"], i4: ["a"] };
    const t = tagContrast(phiMatrix(m), m.items, same);
    expect(t.other.total).toBe(0);
    expect(t.diff).toBeNull();
  });
  it("학생을 빼서 고정 쌍이 계산 불가가 되면 그 반복은 무효", () => {
    // i1은 s1만 정답 → s1을 빼면 i1이 상수가 된다
    const g: (0 | 1)[][] = [
      [1, 1, 1, 0],
      [0, 1, 0, 1],
      [0, 0, 1, 1],
      [0, 0, 0, 0],
    ];
    const r = looContrast(buildMatrix(dataset(items, g)), q);
    expect(r.valid).toBe(3);
    expect(r.total).toBe(4);
  });
  it("미응시는 빼고 무응답은 0점·오답 칸에 넣는다", () => {
    const two = [mcq("i1", 1, ["a"]), mcq("i2", 2, ["b"])];
    const mm = buildMatrix(dataset(two, [[null, null], [1, 0], [0, 1], [1, 1], [1, 1]], { notAttempted: [4] }));
    expect(scoreRows(mm)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    expect(pairTable(mm, "i1", "i2")).toEqual({ a: "i1", b: "i2", bothCorrect: 1, aOnly: 1, bOnly: 1, bothWrong: 1, bothUnanswered: 1, n: 4 });
  });
});

describe("quiz-w5 데모 회귀 (decisions.md §7.1)", () => {
  const dm = buildMatrix(getDataset("quiz-w5")!);
  const dq = defaultQMatrix(dm.items);
  const phi = phiMatrix(dm);
  const idx = (id: string) => dm.items.findIndex((i) => i.id === id);

  it("응시 완료 25명, 45쌍 = 공유 12 + 비공유 33", () => {
    const t = tagContrast(phi, dm.items, dq);
    expect(dm.students).toHaveLength(25);
    expect(t.shared).toEqual({ mean: expect.closeTo(0.1586, 4), valid: 12, total: 12 });
    expect(t.other).toEqual({ mean: expect.closeTo(-0.021, 4), valid: 33, total: 33 });
    expect(t.untaggedPairs).toBe(0);
    expect(t.diff).toBeCloseTo(0.1795, 4);
  });
  it("학생 1명 제외 범위 0.107~0.210 (25회 모두 유효)", () => {
    const r = looContrast(dm, dq);
    expect(r.valid).toBe(25);
    expect(r.min).toBeCloseTo(0.107, 3);
    expect(r.max).toBeCloseTo(0.21, 3);
  });
  it("극단 쌍과 2×2", () => {
    expect(phi[idx("q1")]![idx("q8")]).toBeCloseTo(0.5104, 4);
    expect(phi[idx("q1")]![idx("q4")]).toBeCloseTo(-0.5145, 4);
    const t18 = pairTable(dm, "q1", "q8");
    expect([t18.bothCorrect, t18.aOnly, t18.bOnly, t18.bothWrong]).toEqual([12, 4, 2, 7]);
    const t45 = pairTable(dm, "q4", "q5");
    expect([t45.bothCorrect, t45.aOnly, t45.bOnly, t45.bothWrong]).toEqual([8, 9, 1, 7]);
  });
  it("태그를 바꾸면 묶음 값만 바뀌고 phi는 그대로 (phi는 태그를 입력으로 받지 않는다)", () => {
    const edited = { ...dq, q8: [...(dq.q8 ?? []), "c-hyp"] };
    // 시간복잡도 문항 q1·q3·q5와의 3쌍이 공유 태그 있음으로 옮겨간다
    expect(tagContrast(phi, dm.items, edited).shared.total).toBe(15);
    expect(phiMatrix(dm)).toEqual(phi);
  });
});
