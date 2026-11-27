// 활동 ↔ 강의계획서 연결 검사 (docs/decisions.md U19, 계획 P2). 계획서로 옮겨도 기존 산출물·저장값이 그대로인지 본다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { forumDesignBasis, type ForumDesignInput } from "@/lib/ai/tasks/forumDesign";
import { tagDraftBasis, tagDraftInput } from "@/lib/ai/tasks/tagDraft";
import { getCourseById, getDataset, getEssayDataset, getForum } from "@/lib/data";
import { FORUM_F5 } from "@/lib/forum/content/f5";
import { COURSE_LIT201, FORUM_LIT_F3 } from "@/lib/forum/content/litF3";
import { designInput } from "@/lib/forum/inputs";
import { forumIdList } from "@/lib/forum/registry";
import { restoreChecklist } from "@/lib/forum/state";
import { SYLLABUS_ALGO101 } from "@/lib/syllabus/content/algo101";
import { getSyllabus } from "@/lib/syllabus/registry";
import {
  conceptsFrom,
  courseHomeHref,
  forumObjectives,
  refScopeLabel,
  sectionHref,
  sectionTitle,
  syllabusAnchor,
  syllabusHref,
  syllabusItem,
  syllabusWeekAnchor,
  syllabusWeekHref,
} from "@/lib/syllabus/resolve";
import { syllabusUsage } from "@/lib/syllabus/usage";

const quizW5 = getDataset("quiz-w5")!;
const quizW5e = getEssayDataset("quiz-w5e")!;

describe("퀴즈·서술형 → 계획서 개념", () => {
  it.each([quizW5.quiz, quizW5e.quiz].map((q) => [q.id, q] as const))("%s: 개념 이름·설명이 계획서와 같다", (_, quiz) => {
    const syl = getSyllabus(quiz.courseId)!;
    expect(quiz.concepts).toEqual(conceptsFrom(syl, quiz.concepts.map((c) => c.id)));
  });

  it("서술형 루브릭 기준의 개념은 모두 계획서에 있다", () => {
    const ids = new Set(getSyllabus("algo101")!.concepts.map((c) => c.id));
    for (const it of quizW5e.quiz.items) for (const c of it.rubric) for (const cid of c.conceptIds) expect(ids.has(cid), `${c.id} → ${cid}`).toBe(true);
  });

  it("conceptsFrom은 요청 순서·키 순서를 지키고 없는 개념은 오류다", () => {
    const cs = conceptsFrom(SYLLABUS_ALGO101, ["c-dist", "c-hyp"]);
    expect(cs.map((c) => c.id)).toEqual(["c-dist", "c-hyp"]);
    expect(Object.keys(cs[0]!)).toEqual(["id", "name", "description"]);
    expect(() => conceptsFrom(SYLLABUS_ALGO101, ["l-irony"])).toThrow(/l-irony/);
  });
});

describe("강좌 섹션 제목 → 계획서 주차", () => {
  it("LIT201 섹션 제목이 바뀌지 않았다", () => {
    expect(COURSE_LIT201.sections.map((s) => s.title)).toEqual(["General", "1주차: 시를 읽는 방법", "2주차: 민요시와 율격", "3주차: 김소월", "4주차: 한용운"]);
  });

  it("sectionTitle은 없는 주차에서 오류다", () => {
    expect(sectionTitle(SYLLABUS_ALGO101, 5)).toBe("5주차: 복잡도와 그래프 탐색");
    expect(() => sectionTitle(SYLLABUS_ALGO101, 9)).toThrow(/9주차/);
  });
});

// 토론 목표 문장은 b0-prereg.md §2에서 사전 등록했다. 문장이 바뀌면 같은 id의 의미가 바뀌므로 저장된 교수 체크표가
// 다른 목표에 붙지 않게 토론 dataVersion을 올려야 한다(restoreChecklist는 dataVersion만 본다). 버전별 문장을 여기에 쌓는다.
const OBJECTIVE_TEXT_BY_VERSION: Record<string, Record<string, string[]>> = {
  f5: {
    "2026-11-26.1": [
      "그래프 탐색(이웃의 이웃)과 협업 필터링으로 추천 후보를 만드는 원리를 설명한다",
      "추천 결과가 다시 학습 데이터가 되는 피드백 루프가 노출 다양성을 줄이는 과정을 설명한다",
      "정확도·다양성·참신성 같은 추천 품질 지표가 서로 충돌하는 경우를 구분한다",
      "주장에 이유·근거·보장(조건)을 갖춘 논증을 쓴다",
      "다른 입장의 근거를 정확히 옮기고 그에 응답한다",
    ],
  },
  "lit-f3": {
    "2026-11-26.1": [
      "반복·종결어미·높임 표현 같은 형식 요소를 근거로 화자의 태도를 해석한다",
      "반어를 개념으로 설명하고 작품의 구절에 적용한다",
      "작품을 1920년대 민요조 율격과 이별 노래의 전통(정한) 맥락에서 읽는다",
      "해석 주장을 작품 구절과 연결 이유로 뒷받침한다",
      "다른 해석을 정확히 옮기고 인정·반박·종합한다",
    ],
  },
};

describe("토론 목표 → 계획서 목표", () => {
  it.each(forumIdList())("%s: 목표 문장이 이 dataVersion에 기록된 문장과 같다(바꾸면 dataVersion을 올리고 새 줄을 더한다)", (id) => {
    const ds = getForum(id)!;
    const recorded = OBJECTIVE_TEXT_BY_VERSION[id]?.[ds.dataVersion];
    expect(recorded, `${id} ${ds.dataVersion}의 목표 문장 기록이 없습니다`).toBeDefined();
    expect(ds.objectives.map((o) => o.text)).toEqual(recorded);
  });

  it.each(forumIdList())("%s: 모든 목표가 같은 강좌 계획서의 목표를 가리키고 kind가 같다", (id) => {
    const ds = getForum(id)!;
    const syl = getSyllabus(ds.forum.courseId)!;
    for (const o of ds.objectives) {
      const so = syl.objectives.find((x) => x.id === o.syllabusId);
      expect(so, `${id} ${o.id}`).toBeDefined();
      expect(o.kind).toBe(so!.kind);
      expect(o.text).toBe(so!.text);
    }
  });

  it("forumObjectives: 다른 강좌의 목표나 없는 목표는 오류다", () => {
    expect(() => forumObjectives(SYLLABUS_ALGO101, { O1: "w3-form" })).toThrow(/w3-form/);
    expect(() => forumObjectives(SYLLABUS_ALGO101, { O1: "nope" })).toThrow(/nope/);
  });

  it("변경 전에 저장된 교수 체크표가 그대로 복원된다", () => {
    const stored = { dataVersion: "2026-11-26.1", cells: { "O1|Q1": "required", "O3|common": "none", "O5|Q4": "optional" }, source: "manual", updatedAt: "2026-11-26T10:00:00.000Z" };
    expect(restoreChecklist(JSON.parse(JSON.stringify(stored)), FORUM_F5)).toEqual(stored);
  });
});

describe("AI 입력이 바뀌지 않았다 (v1)", () => {
  const live = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", "live", f), "utf8")) as { input: ForumDesignInput };

  it.each([
    [FORUM_F5, "forum-design-f5-k-exaone_v2.5-2026-11-26-r2.json"],
    [FORUM_LIT_F3, "forum-design-lit-f3-k-exaone_v2.5-2026-11-26-r2.json"],
  ] as const)("%#: designInput이 2026-11-26 실연 기록의 입력과 같다(syllabusId가 새지 않음)", (ds, file) => {
    const rec = live(file);
    expect(designInput(ds)).toEqual(rec.input);
    expect(forumDesignBasis(designInput(ds))).toBe(forumDesignBasis(rec.input));
  });

  it("tag-draft basis가 계획서 도입 전 값과 같다", () => {
    expect(tagDraftBasis(tagDraftInput(quizW5.quiz.concepts, quizW5.quiz.items))).toBe("046807a8ed2c80");
  });
});

describe("계획서 항목을 쓰는 곳 (직접 연결만)", () => {
  const usage = syllabusUsage(SYLLABUS_ALGO101, { quizzes: [quizW5], essays: [quizW5e], forums: forumIdList().map((id) => getForum(id)!) });

  it("c-clu: 퀴즈 6·7·10번, 서술형 2번의 두 기준", () => {
    const u = usage["c-clu"]!;
    expect(u.filter((x) => x.kind === "quiz-item").map((x) => x.label)).toEqual(["6번 문항", "7번 문항", "10번 문항"]);
    expect(u.filter((x) => x.kind === "essay-criterion").map((x) => x.label)).toEqual(["2번 · 알고리즘 차이", "2번 · 결론과 근거 연결"]);
    expect(u.some((x) => x.kind === "forum-objective")).toBe(false);
  });

  it("토론 목표는 그 계획서 목표에만 붙고, 개념을 거친 연결은 세지 않는다", () => {
    expect(usage["w5-recsys"]).toEqual([{ kind: "forum-objective", activityId: "f5", activityName: FORUM_F5.forum.name, label: "O1", href: "/forum/f5/design/" }]);
    expect(usage["g-argue"]!.map((x) => x.label)).toEqual(["O4"]);
    // w5-recsys는 c-clu를 다루지만, c-clu의 퀴즈 문항이 w5-recsys의 "쓰는 곳"이 되지는 않는다
    expect(usage["w5-recsys"]!.some((x) => x.kind === "quiz-item")).toBe(false);
  });

  it("평가 활동이 없는 항목은 비어 있고, 다른 강좌 활동은 섞이지 않는다", () => {
    expect(usage["c-dp"]).toBeUndefined();
    expect(Object.values(usage).flat().some((x) => x.activityId === "lit-f3")).toBe(false);
  });
});

describe("링크", () => {
  it("강좌 홈·섹션·계획서 경로", () => {
    expect(courseHomeHref("algo101")).toBe("/courses/");
    expect(courseHomeHref("lit201")).toBe("/courses/lit201/");
    expect(sectionHref("algo101", 5)).toBe("/courses/#sec-5");
    expect(sectionHref("lit201", 3)).toBe("/courses/lit201/#sec-3");
    expect(syllabusHref("algo101")).toBe("/courses/algo101/syllabus/");
    expect(syllabusHref("lit201", "w3-form")).toBe("/courses/lit201/syllabus/#syl-w3-form");
    expect(syllabusAnchor("c-clu")).toBe("syl-c-clu");
    expect(syllabusWeekHref("algo101", 5)).toBe("/courses/algo101/syllabus/#syl-week-5");
  });

  it("주차 앵커는 어떤 항목 앵커와도 겹치지 않는다", () => {
    for (const id of ["algo101", "lit201"]) {
      const syl = getSyllabus(id)!;
      const items = new Set([...syl.concepts, ...syl.objectives].map((x) => syllabusAnchor(x.id)));
      for (const w of syl.weeks) expect(items.has(syllabusWeekAnchor(w.week))).toBe(false);
    }
  });

  it("링크 글자의 범위: 강좌 역량 / 주차", () => {
    expect(refScopeLabel(syllabusItem(SYLLABUS_ALGO101, "g-argue")!)).toBe("강좌 역량");
    expect(refScopeLabel(syllabusItem(SYLLABUS_ALGO101, "w5-recsys")!)).toBe("5주차");
    expect(refScopeLabel(syllabusItem(SYLLABUS_ALGO101, "c-hyp")!)).toBe("1·5주차");
  });

  it("데모 강좌마다 계획서가 있다", () => {
    for (const id of ["algo101", "lit201"]) {
      expect(getCourseById(id)).not.toBeNull();
      expect(getSyllabus(id)).not.toBeNull();
    }
  });
});
