// AI 초안·반영 기록의 저장 계약 테스트 (docs/decisions.md §8.2).
import { describe, expect, it } from "vitest";
import {
  editedProvenance,
  relationSnapshot,
  restoreDrafts,
  restoreProvenance,
  restoreRelations,
  restoreSummaryFinal,
  snapshotsCurrent,
  type AiDraft,
  type ConfirmedRelation,
} from "@/lib/state/aiRecords";

const draft = (over: Partial<AiDraft> = {}): AiDraft => ({
  draftId: "dr-1",
  task: "tag-draft",
  quizId: "quiz-w5",
  dataVersion: "v1",
  provider: "mock",
  requestedModel: "rules-v1",
  responseModel: "rules-v1",
  promptVersion: "tag-draft-v1",
  schemaVersion: "1",
  validatorVersion: "1",
  basisHash: "h",
  input: {},
  createdAt: "2026-11-10T00:00:00.000Z",
  result: { status: "valid" },
  ...over,
});

const rel = (over: Partial<ConfirmedRelation> = {}): ConfirmedRelation => ({
  id: "r1",
  from: "a",
  to: "b",
  type: "prerequisite",
  rationale: "",
  fromItemIds: ["q1"],
  toItemIds: ["q2"],
  source: "manual",
  confirmedAt: "2026-11-10T00:00:00.000Z",
  ...over,
});
const C = new Set(["a", "b", "c"]);
const I = new Set(["q1", "q2"]);

describe("초안 저장소", () => {
  it("읽을 수 없는 항목은 버리지 않고 unreadable로 옮긴다. 다른 데이터 버전 초안도 지우지 않는다", () => {
    const r = restoreDrafts({ drafts: [draft(), { junk: 1 }, draft({ draftId: "dr-2", dataVersion: "old" })], unreadable: ["earlier"] }, "v1")!;
    expect(r.drafts.map((d) => d.draftId)).toEqual(["dr-1", "dr-2"]);
    expect(r.unreadable).toEqual(["earlier", { junk: 1 }]);
  });

  it("drafts 배열이 없으면 복원 실패(저장 훅이 원문을 따로 보존)", () => {
    expect(restoreDrafts({ nope: true }, "v1")).toBeNull();
  });
});

describe("Q-matrix 출처", () => {
  it("출처가 없으면 default로 채우고, 틀린 값이면 복원 실패", () => {
    expect(restoreProvenance(undefined, ["q1"])).toEqual({ q1: { source: "default" } });
    expect(restoreProvenance({ q1: { source: "ai", basedOnDraftId: "dr-1" } }, ["q1", "q2"])).toEqual({ q1: { source: "ai", basedOnDraftId: "dr-1" }, q2: { source: "default" } });
    expect(restoreProvenance({ q1: { source: "robot" } }, ["q1"])).toBeNull();
  });

  it("직접 고치면 AI 반영 문항은 ai-edited(근거 초안 유지), 나머지는 manual", () => {
    expect(editedProvenance({ source: "ai", basedOnDraftId: "dr-1" })).toEqual({ source: "ai-edited", basedOnDraftId: "dr-1" });
    expect(editedProvenance({ source: "default" })).toEqual({ source: "manual" });
    expect(editedProvenance(undefined)).toEqual({ source: "manual" });
  });
});

describe("확정 관계", () => {
  it("정상 관계는 복원되고, 순환·중복 쌍·모르는 개념·다른 데이터 버전은 거부한다", () => {
    expect(restoreRelations({ dataVersion: "v1", relations: [rel()] }, "v1", C, I)!.relations).toHaveLength(1);
    expect(restoreRelations({ dataVersion: "v1", relations: [rel(), rel({ id: "r2", from: "b", to: "a" })] }, "v1", C, I)).toBeNull();
    expect(restoreRelations({ dataVersion: "v1", relations: [rel(), rel({ id: "r2", from: "b", to: "c" }), rel({ id: "r3", from: "c", to: "a" })] }, "v1", C, I)).toBeNull();
    expect(restoreRelations({ dataVersion: "v1", relations: [rel({ to: "z" })] }, "v1", C, I)).toBeNull();
    expect(restoreRelations({ dataVersion: "v0", relations: [] }, "v1", C, I)).toBeNull();
  });

  it("묶음이 쓴 관계 스냅숏: 유형이 바뀌거나 삭제되면 현재와 다르다", () => {
    const snaps = [relationSnapshot(rel())];
    expect(snapshotsCurrent(snaps, [rel()])).toBe(true);
    expect(snapshotsCurrent(snaps, [rel({ type: "related" })])).toBe(false);
    expect(snapshotsCurrent(snaps, [])).toBe(false);
    expect(snapshotsCurrent(snaps, [rel(), rel({ id: "r9", from: "b", to: "c" })])).toBe(true); // 무관한 관계 추가는 영향 없음
  });
});

describe("요약 확정본", () => {
  it("형식과 데이터 버전을 검사한다", () => {
    const f = { dataVersion: "v1", basedOnDraftId: "dr-1", basisHash: "h", sections: [{ heading: "전체 요약", sentences: ["{F01}"] }], savedAt: "t" };
    expect(restoreSummaryFinal(f, "v1")).toEqual(f);
    expect(restoreSummaryFinal({ ...f, sections: [{ heading: 1 }] }, "v1")).toBeNull();
    expect(restoreSummaryFinal(f, "v2")).toBeNull();
  });
});
