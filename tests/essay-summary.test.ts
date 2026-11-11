// 서술형 결과 요약 초안 테스트 (docs/decisions.md §6, §8.4). 확정 점수만 사실이 되고, 요약 검증은 객관식과 같다.
import { describe, expect, it } from "vitest";
import w5e from "@/data/quiz-w5e.json";
import { analysisSummaryTask, validateAnalysisSummary } from "@/lib/ai/tasks/analysisSummary";
import { recordKey, type EssayGradesState } from "@/lib/essay/grades";
import { buildEssayFacts, hasFinals } from "@/lib/essay/facts";
import type { EssayQuizDataset } from "@/lib/types";

const ds = w5e as unknown as EssayQuizDataset;
const empty: EssayGradesState = { dataVersion: ds.dataVersion, records: {} };

/** 기준 채점을 교수 직접 채점으로 확정했다고 가정한 상태 */
function withFinals(n: number): EssayGradesState {
  const records: EssayGradesState["records"] = {};
  for (const ref of ds.referenceGrades.slice(0, n)) {
    records[recordKey(ref.attemptId, ref.itemId)] = { suggestions: [], final: { levels: ref.levels, feedback: "", source: "manual", decidedAt: "2026-11-10T00:00:00.000Z" } };
  }
  return { dataVersion: ds.dataVersion, records };
}

describe("서술형 사실 목록", () => {
  it("확정이 없으면 응시·확정률·제출 특징만 만들고 실행 조건은 거짓이다", () => {
    const f = buildEssayFacts(ds, empty);
    expect(f.map((x) => x.kind)).toEqual(["attempts", "essay-confirmation", "essay-submission-flags"]);
    expect(f[1]!.text).toContain("채점 확정 0건");
    expect(hasFinals(ds, empty)).toBe(false);
  });

  it("확정 점수로 개념 점수율·기준 분포·비교 사실을 만들고, 학생 이름·답안 원문은 넣지 않는다", () => {
    const st = withFinals(20);
    const f = buildEssayFacts(ds, st);
    expect(hasFinals(ds, st)).toBe(true);
    expect(f.find((x) => x.kind === "essay-confirmation")).toMatchObject({ numerator: 20 });
    expect(f.find((x) => x.kind === "essay-final-source")!.text).toBe("확정 출처: AI 제안 수락 0건, 수정 후 확정 0건, 직접 채점 20건");
    expect(f.filter((x) => x.kind === "essay-concept-rate").length).toBeGreaterThan(0);
    expect(f.filter((x) => x.kind === "essay-criterion-dist").every((x) => /확정 \d+건\)$/.test(x.text))).toBe(true);
    expect(f.some((x) => x.kind === "essay-ai-agreement")).toBe(false); // 제안에 연결된 확정이 없음
    const names = ds.students.map((s) => s.name);
    const texts = ds.submissions.map((s) => s.text).filter((t): t is string => !!t && t.length > 20);
    expect(f.every((x) => names.every((n) => !x.text.includes(n)) && texts.every((t) => !x.text.includes(t.slice(0, 20))))).toBe(true);
    expect(f.map((x) => x.id)).toEqual(f.map((_, i) => `F${String(i + 1).padStart(2, "0")}`));
  });

  it("같은 요약 작업으로 Mock 초안이 검증을 통과하고, 토큰 밖 숫자는 검토 필요가 된다", () => {
    const facts = buildEssayFacts(ds, withFinals(30));
    const v = validateAnalysisSummary(analysisSummaryTask.mock({ facts }), { facts });
    expect(v.status).toBe("valid");
    expect(v.sections.map((s) => s.heading)).toEqual(["전체 요약", "눈여겨볼 개념", "문항 점검", "다음 수업 제안"]);
    const bad = validateAnalysisSummary({ sections: [{ heading: "전체 요약", sentences: ["{F02} 중 열 명이 미흡입니다."] }] }, { facts });
    expect(bad.status).toBe("needs-review");
  });
});
