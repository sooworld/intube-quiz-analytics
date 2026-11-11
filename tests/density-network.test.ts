import { describe, expect, it } from "vitest";
import { dbscan } from "@/lib/analysis/dbscan";
import { buildMatrix, defaultQMatrix } from "@/lib/analysis/matrix";
import { itemNetwork } from "@/lib/analysis/network";
import { dataset, mcq } from "./fixtures/build";

// 1차원 점 0, 1, 2, 10, 11, 30 의 거리 행렬
const pts = [0, 1, 2, 10, 11, 30];
const D = pts.map((a) => pts.map((b) => Math.abs(a - b)));

describe("DBSCAN", () => {
  it("핵심점·경계점·노이즈 손계산 (eps=1, minPts=2, 자기 포함)", () => {
    const r = dbscan(D, 1, 2);
    expect(r.labels).toEqual([0, 0, 0, 1, 1, -1]);
    expect(r.clusterCount).toBe(2);
    expect(r.noiseCount).toBe(1);
  });
  it("minPts=3이면 경계점이 생긴다", () => {
    const r = dbscan(D, 1, 3);
    // 1만 이웃 3개(0,1,2)로 핵심점. 0과 2는 경계점. 10·11·30은 미배정
    expect(r.core).toEqual([false, true, false, false, false, false]);
    expect(r.labels).toEqual([0, 0, 0, -1, -1, -1]);
  });
  it("전원 미배정도 정상 결과", () => {
    expect(dbscan(D, 0.5, 2).labels.every((l) => l === -1)).toBe(true);
  });
});

describe("문항 네트워크", () => {
  const items = [mcq("q1", 1, ["a"]), mcq("q2", 2, ["a"]), mcq("q3", 3, ["b"])];
  // q1·q2를 s1,s2,s3가 함께 틀림, q3은 s4만
  const m = buildMatrix(dataset(items, [[0, 0, 1], [0, 0, 1], [0, 0, 1], [1, 1, 0]]));
  const q = defaultQMatrix(items);
  it("동시 오답 기준: 근거 충분한 쌍만", () => {
    const e = itemNetwork(m, q, "cowrong", 0.5);
    expect(e.map((x) => [x.a, x.b, x.support])).toEqual([["q1", "q2", 3]]);
    expect(e[0]!.weight).toBe(1);
  });
  it("개념 태그 기준은 응답과 무관", () => {
    const e = itemNetwork(m, q, "concept", 0.1);
    expect(e.map((x) => [x.a, x.b])).toEqual([["q1", "q2"]]);
    expect(e[0]!.sharedConcepts).toEqual(["a"]);
  });
});
