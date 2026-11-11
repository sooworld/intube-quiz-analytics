import { describe, expect, it } from "vitest";
import { classConcept, reviewPriorities, studentConcept } from "@/lib/analysis/concepts";
import { gradeItem, misconceptionCandidate, normalizeAnswer } from "@/lib/analysis/grading";
import { clusterSensitivity, conceptGroups, exploreClusters, movedCount } from "@/lib/analysis/groups";
import { cutTree, hclustAverage } from "@/lib/analysis/hclust";
import { allItemStats, pearson } from "@/lib/analysis/itemStats";
import { buildMatrix, defaultQMatrix, hashQMatrix } from "@/lib/analysis/matrix";
import { itemPair, itemSimilarityMatrix, jaccardDistance } from "@/lib/analysis/similarity";
import type { Item } from "@/lib/types";
import { C, dataset, mcq } from "./fixtures/build";

// 문항: q1,q2 → 개념 a / q3 → 개념 b / q4 → a,b (다중 태그)
const items = [mcq("q1", 1, ["a"]), mcq("q2", 2, ["a"]), mcq("q3", 3, ["b"]), mcq("q4", 4, ["a", "b"])];
// 학생 4명 + 미응시 1명
const grid: (0 | 1 | null)[][] = [
  [1, 1, 1, 1], // s1 전부 정답
  [0, 0, 1, 0], // s2: q1,q2,q4 오답
  [0, 1, 0, null], // s3: q1,q3 오답, q4 무응답
  [1, 0, 0, 0], // s4: q2,q3,q4 오답
  [0, 0, 0, 0], // s5 미응시
];
const ds = dataset(items, grid, { notAttempted: [4] });
const m = buildMatrix(ds);
const q = defaultQMatrix(items);

describe("응답 행렬", () => {
  it("미응시 학생은 분석 대상에서 빠진다", () => {
    expect(m.students.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(m.notAttempted.map((s) => s.id)).toEqual(["s5"]);
  });
  it("무응답은 unanswered로 남는다", () => {
    expect(m.state.s3!.q4).toBe("unanswered");
  });
});

describe("문항분석", () => {
  const stats = allItemStats(m);
  it("정답률은 정답 인원/응시 완료 인원", () => {
    expect(stats[0]!.facility).toMatchObject({ numerator: 2, denominator: 4, value: 0.5 });
    expect(stats[3]!.facility).toMatchObject({ numerator: 1, denominator: 4, value: 0.25 });
    expect(stats[3]!.unanswered).toBe(1);
  });
  it("선택지 분포는 인원을 센다 (무응답 제외)", () => {
    const q4 = stats[3]!.options!;
    expect(q4.find((o) => o.optionId === "A")!.count).toBe(1);
    expect(q4.find((o) => o.optionId === "B")!.count).toBe(2);
  });
  it("변별도: 분산이 0이면 null", () => {
    const allRight = buildMatrix(dataset([mcq("x", 1, ["a"]), mcq("y", 2, ["a"])], [[1, 1], [1, 0]]));
    expect(allItemStats(allRight)[0]!.discrimination).toBeNull();
  });
  it("피어슨 상관 손계산", () => {
    expect(pearson([1, 0, 1, 0], [3, 1, 2, 0])).toBeCloseTo(0.8944, 3);
  });
});

describe("개념 관찰 오답률 (D1)", () => {
  it("다중 태그 문항은 두 개념 모두에 반영", () => {
    // s2: 개념 a 태그 문항 q1,q2,q4 중 3개 오답 / 개념 b 태그 q3,q4 중 q4 1개 오답
    expect(studentConcept(m, q, "s2", "a")).toMatchObject({ numerator: 3, denominator: 3, value: 1 });
    expect(studentConcept(m, q, "s2", "b")).toMatchObject({ numerator: 1, denominator: 2, value: 0.5, evidenceItemIds: ["q4"] });
  });
  it("태그 문항이 없는 개념은 0%가 아니라 자료 없음(null)", () => {
    expect(studentConcept(m, q, "s1", "z")).toMatchObject({ value: null, denominator: 0 });
    expect(classConcept(m, q, "z").value).toBeNull();
  });
  it("학급 오답률 = 오답 수 / (태그 문항 수 × 인원)", () => {
    // 개념 a: q1 오답 2, q2 오답 2, q4 오답 3 = 7 / 12
    expect(classConcept(m, q, "a")).toMatchObject({ numerator: 7, denominator: 12 });
  });
  it("복습 우선순위는 개인 오답률 기준이며 학급 대비 차이를 쓰지 않는다", () => {
    const pr = reviewPriorities(m, q, C, "s4");
    // s4: a = q2,q4 오답 2/3, b = q3,q4 오답 2/2 → b 먼저
    expect(pr.map((p) => p.conceptId)).toEqual(["b", "a"]);
    expect(reviewPriorities(m, q, C, "s1")).toEqual([]);
  });
});

describe("동시 오답 유사도", () => {
  it("Jaccard와 공동 오답 수 손계산", () => {
    // q1 오답: s2,s3 / q4 오답: s2,s3,s4 → 공동 2, 합집합 3
    expect(itemPair(m, "q1", "q4")).toMatchObject({ coWrong: 2, union: 3, wrongA: 2, wrongB: 3, sufficient: true });
    expect(itemPair(m, "q1", "q4").jaccard).toBeCloseTo(2 / 3);
  });
  it("공동 오답자가 2명 미만이면 근거 부족", () => {
    // q1: s2,s3 / q3: s3,s4 → 공동 1
    expect(itemPair(m, "q1", "q3")).toMatchObject({ coWrong: 1, sufficient: false });
  });
  it("오답자가 없는 두 문항은 null (분모 0)", () => {
    const mm = buildMatrix(dataset([mcq("x", 1, ["a"]), mcq("y", 2, ["a"])], [[1, 1], [1, 1]]));
    expect(itemSimilarityMatrix(mm)[0]![1]!.jaccard).toBeNull();
  });
  it("Jaccard 거리: 둘 다 빈 집합이면 0", () => {
    expect(jaccardDistance(new Set(), new Set())).toBe(0);
    expect(jaccardDistance(new Set([1, 2]), new Set([2, 3]))).toBeCloseTo(2 / 3);
  });
});

describe("계층 군집", () => {
  const d = [
    [0, 1, 4, 5],
    [1, 0, 3, 6],
    [4, 3, 0, 2],
    [5, 6, 2, 0],
  ];
  it("평균 연결 병합 순서와 높이 손계산", () => {
    const r = hclustAverage(d);
    expect(r.merges.map((x) => [x.left, x.right, x.height])).toEqual([
      [0, 1, 1],
      [2, 3, 2],
      [4, 5, 4.5], // (4+5+3+6)/4
    ]);
    expect(cutTree(r, 2)).toEqual([0, 0, 1, 1]);
    expect(cutTree(r, 1)).toEqual([0, 0, 0, 0]);
    expect(cutTree(r, 4)).toEqual([0, 1, 2, 3]);
  });
  it("거리 동률은 낮은 번호 쌍을 먼저 합친다", () => {
    const tie = [
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ];
    expect(hclustAverage(tie).merges[0]).toMatchObject({ left: 0, right: 1 });
  });
  it("단일 학생도 처리한다", () => {
    expect(cutTree(hclustAverage([[0]]), 3)).toEqual([0]);
  });
});

describe("그룹", () => {
  it("개념 보충 그룹: 기준 이상, 중복 소속 허용", () => {
    const g = conceptGroups(m, q, C, 0.5);
    expect(g.find((x) => x.conceptId === "a")!.members.map((x) => x.studentId)).toEqual(["s2", "s3", "s4"]);
    expect(g.find((x) => x.conceptId === "b")!.members.map((x) => x.studentId)).toEqual(["s2", "s3", "s4"]);
    expect(g.find((x) => x.conceptId === "z")!.hasEvidence).toBe(false);
  });
  it("전원 정답이면 그룹이 비어 있다 (그룹을 제안하지 않아야 하는 사례)", () => {
    const mm = buildMatrix(dataset(items, [[1, 1, 1, 1], [1, 1, 1, 1]]));
    expect(conceptGroups(mm, q, C).every((g) => g.members.length === 0)).toBe(true);
  });
  it("옮겨 간 학생 수는 라벨 번호와 무관하다", () => {
    expect(movedCount([0, 0, 1], [1, 1, 0])).toBe(0);
    // b 한 명만 다른 묶음으로 갔다 (같은 묶음 친구가 바뀐 학생은 a·b·c 셋이지만 옮겨 간 학생은 하나)
    expect(movedCount([0, 0, 1], [0, 1, 1])).toBe(1);
  });
  it("옮겨 간 학생 수는 가장 잘 맞는 일대일 대응으로 센다", () => {
    // 4명 묶음이 2명씩 둘로 갈라지면 2명이 옮겨 간 것이다
    expect(movedCount([0, 0, 0, 0], [0, 0, 1, 1])).toBe(2);
    // 묶음 번호가 뒤섞여도 결과는 같다
    expect(movedCount([0, 0, 1, 1, 2], [2, 2, 0, 0, 1])).toBe(0);
  });
  it("미배정(-1)은 묶음이 아니다", () => {
    expect(movedCount([0, 0, -1, -1], [0, 0, -1, -1])).toBe(0); // 두 번 다 미배정이면 그대로
    expect(movedCount([0, 0, -1], [0, 0, 0])).toBe(1); // 미배정 → 묶음
    expect(movedCount([0, 0, 1], [0, 0, -1])).toBe(1); // 묶음 → 미배정
    expect(movedCount([-1, -1], [0, 0])).toBe(2);
  });
  it("민감도 값은 0 이상 학생 수 이하", () => {
    const s = clusterSensitivity(m, 2);
    expect(s.perItem).toHaveLength(4);
    expect(s.max).toBeGreaterThanOrEqual(0);
    expect(s.max).toBeLessThanOrEqual(4);
  });
});

describe("학생 순서 불변성", () => {
  it("입력 순서를 뒤집어도 결과가 같다", () => {
    const shuffled = buildMatrix(dataset(items, grid, { notAttempted: [4], shuffle: true }));
    const a = exploreClusters(m, q, C, 2);
    const b = exploreClusters(shuffled, q, C, 2);
    expect(b.studentIds).toEqual(a.studentIds);
    expect(b.labels).toEqual(a.labels);
    expect(allItemStats(shuffled)).toEqual(allItemStats(m));
  });
});

describe("Q-matrix 해시", () => {
  it("순서와 무관하고 내용이 바뀌면 달라진다", () => {
    expect(hashQMatrix({ q1: ["a", "b"], q2: ["a"] })).toBe(hashQMatrix({ q2: ["a"], q1: ["b", "a"] }));
    expect(hashQMatrix({ q1: ["a"] })).not.toBe(hashQMatrix({ q1: ["b"] }));
  });
});

describe("단답 채점 (D3)", () => {
  const num: Item = {
    id: "n", number: 1, type: "short", stem: "", conceptIds: [],
    shortAnswer: { policy: "numeric", accepted: ["0.05"], tolerance: 0, misconceptionRules: [{ equals: ["5"], label: "단위 혼동" }] },
  };
  const neg: Item = { ...num, id: "neg", shortAnswer: { policy: "numeric", accepted: ["1"], tolerance: 0.01 } };
  const text: Item = {
    id: "t", number: 2, type: "short", stem: "", conceptIds: [],
    shortAnswer: { policy: "text", accepted: ["Jaccard 유사도"], misconceptionRules: [{ includesAll: ["코사인"], label: "코사인 혼동" }] },
  };
  it("정규화는 NFKC·공백·대소문자만 다룬다", () => {
    expect(normalizeAnswer("  JACCARD   유사도 ")).toBe("jaccard 유사도");
    expect(normalizeAnswer("５")).toBe("5");
  });
  it("0.05와 005, -1과 1을 합치지 않는다", () => {
    expect(gradeItem(num, "0.05")).toBe("correct");
    expect(gradeItem(num, "005")).toBe("incorrect");
    expect(gradeItem(neg, "1.00")).toBe("correct");
    expect(gradeItem(neg, "-1")).toBe("incorrect");
  });
  it("단위가 붙은 숫자는 정답 처리하지 않는다", () => {
    expect(gradeItem(neg, "1cm")).toBe("incorrect");
  });
  it("허용 답안 변형은 정답, 문장부호가 다르면 오답", () => {
    expect(gradeItem(text, "jaccard  유사도")).toBe("correct");
    expect(gradeItem(text, "jaccard-유사도")).toBe("incorrect");
  });
  it("무응답", () => {
    expect(gradeItem(text, null)).toBe("unanswered");
    expect(gradeItem(text, "   ")).toBe("unanswered");
  });
  it("오개념 후보: 규칙에 맞으면 라벨, 아니면 미분류(null)", () => {
    expect(misconceptionCandidate(num, "5")).toBe("단위 혼동");
    expect(misconceptionCandidate(text, "코사인 유사도")).toBe("코사인 혼동");
    expect(misconceptionCandidate(text, "피어슨")).toBeNull();
  });
});
