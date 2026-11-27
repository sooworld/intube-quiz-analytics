// 강의계획서 계약·내용 검사 (docs/decisions.md U19, 계획 P1). 계획서는 가상이고 기존 활동에서 거꾸로 만들었다.
import { describe, expect, it } from "vitest";
import { getCourses, getDataset, getEssayDataset, getForum } from "@/lib/data";
import { forumIdList } from "@/lib/forum/registry";
import { detailSentences, syllabusItem } from "@/lib/syllabus/resolve";
import { getSyllabus, syllabusCourseIds } from "@/lib/syllabus/registry";
import type { Syllabus } from "@/lib/syllabus/types";

const courses = getCourses();
const syllabi = syllabusCourseIds().map((id) => getSyllabus(id)!);

/** 강좌의 퀴즈·서술형·토론 데이터셋 (주차와 개념 목록) */
function assessedConcepts(courseId: string): { activity: string; week: number; conceptIds: string[] }[] {
  const course = courses.find((c) => c.id === courseId)!;
  const out: { activity: string; week: number; conceptIds: string[] }[] = [];
  for (const s of course.sections)
    for (const a of s.activities) {
      const q = getDataset(a.id)?.quiz ?? getEssayDataset(a.id)?.quiz;
      if (q) out.push({ activity: a.id, week: q.sectionNumber, conceptIds: q.concepts.map((c) => c.id) });
    }
  return out;
}

describe("강의계획서 계약", () => {
  it("계획서가 있는 강좌와 데모 강좌가 같다", () => {
    expect([...syllabusCourseIds()].sort()).toEqual(courses.map((c) => c.id).sort());
  });

  it.each(syllabi.map((s) => [s.courseId, s] as [string, Syllabus]))("%s: 항목 id가 개념·목표를 통틀어 고유하다", (_, syl) => {
    const ids = [...syl.concepts.map((c) => c.id), ...syl.objectives.map((o) => o.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(syllabi.map((s) => [s.courseId, s] as [string, Syllabus]))("%s: 주차가 강좌 섹션과 같고 주제가 섹션 제목과 같다", (_, syl) => {
    const course = courses.find((c) => c.id === syl.courseId)!;
    const weekSections = course.sections.filter((s) => s.number !== 0);
    expect(syl.weeks.map((w) => w.week)).toEqual(weekSections.map((s) => s.number));
    for (const w of syl.weeks) expect(weekSections.find((s) => s.number === w.week)!.title).toBe(`${w.week}주차: ${w.topic}`);
  });

  it.each(syllabi.map((s) => [s.courseId, s] as [string, Syllabus]))("%s: 개념·목표의 주차와 목표의 개념이 계획서에 있다", (_, syl) => {
    const weeks = new Set(syl.weeks.map((w) => w.week));
    const concepts = new Set(syl.concepts.map((c) => c.id));
    for (const c of syl.concepts) {
      expect(c.weeks.length, c.id).toBeGreaterThan(0);
      for (const w of c.weeks) expect(weeks.has(w), `${c.id} ${w}주차`).toBe(true);
    }
    for (const o of syl.objectives) {
      if (o.scope.kind === "weeks") {
        expect(o.scope.weeks.length, o.id).toBeGreaterThan(0);
        for (const w of o.scope.weeks) expect(weeks.has(w), `${o.id} ${w}주차`).toBe(true);
      }
      for (const cid of o.conceptIds) expect(concepts.has(cid), `${o.id} → ${cid}`).toBe(true);
    }
  });

  it.each(syllabi.map((s) => [s.courseId, s] as [string, Syllabus]))("%s: 평가 활동이 강좌에 있고 비중 합이 100이다", (_, syl) => {
    const course = courses.find((c) => c.id === syl.courseId)!;
    const activityIds = new Set(course.sections.flatMap((s) => s.activities.map((a) => a.id)));
    for (const e of syl.evaluation) for (const a of e.activityIds) expect(activityIds.has(a), `${e.name} → ${a}`).toBe(true);
    expect(syl.evaluation.reduce((s, e) => s + e.weight, 0)).toBe(100);
  });

  it.each(syllabi.map((s) => [s.courseId, s] as [string, Syllabus]))("%s: 가상 표시와 상세가 있다", (_, syl) => {
    expect(syl.provenance).toMatch(/가상/);
    for (const c of syl.concepts) expect(detailSentences(c.detail).length, c.id).toBeGreaterThan(0);
    for (const o of syl.objectives) expect(detailSentences(o.detail).length, o.id).toBeGreaterThan(0);
  });

  it("배운 뒤에 평가한다: 퀴즈·서술형이 쓰는 개념은 평가 주차 이하에 배운다", () => {
    for (const syl of syllabi)
      for (const a of assessedConcepts(syl.courseId))
        for (const cid of a.conceptIds) {
          const c = syl.concepts.find((x) => x.id === cid);
          expect(c, `${a.activity} → ${cid}`).toBeDefined();
          expect(c!.weeks.some((w) => w <= a.week), `${cid}: 배우는 주차 ${c!.weeks.join(",")} / 평가 ${a.week}주차`).toBe(true);
        }
  });

  it("syllabusItem은 개념·목표를 찾고 없는 id는 null이다", () => {
    const syl = getSyllabus("algo101")!;
    expect(syllabusItem(syl, "c-clu")?.type).toBe("concept");
    expect(syllabusItem(syl, "w5-recsys")?.type).toBe("objective");
    expect(syllabusItem(syl, "nope")).toBeNull();
  });

  it("detailSentences는 문장 끝에서 자르고 빈 문장을 버린다", () => {
    expect(detailSentences("가를 한다. 나를 한다?  다를 한다! ")).toEqual(["가를 한다.", "나를 한다?", "다를 한다!"]);
    expect(detailSentences("")).toEqual([]);
  });
});

// ── 누설 검사 (계획 S5) ───────────────────────────────────────────────────
// 계획서를 활동에서 거꾸로 만들었으므로, 상세가 문항·토론 문장을 베끼면 계획서 기반 연관도·AI 초안이 저절로 좋아 보인다.
// 실패: 문항·논점 번호 표기, 활동 원문과 15자 이상 연속 일치. 보고만(LEAK_REPORT=1): 8–14자 일치.

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function activityTexts(courseId: string): string[] {
  const course = courses.find((c) => c.id === courseId)!;
  const texts: string[] = [];
  for (const s of course.sections)
    for (const a of s.activities) {
      const q = getDataset(a.id)?.quiz;
      if (q) for (const it of q.items) texts.push(it.stem, ...(it.options ?? []).map((o) => o.text));
      const e = getEssayDataset(a.id)?.quiz;
      if (e) for (const it of e.items) texts.push(it.stem, it.context ?? "", ...it.rubric.flatMap((c) => [c.name, ...c.levels.map((l) => l.descriptor)]));
    }
  for (const id of forumIdList()) {
    const f = getForum(id)!;
    if (f.forum.courseId !== courseId) continue;
    texts.push(f.forum.topic, f.forum.intro, ...f.subQuestions.map((q) => q.text), ...f.rubric.map((r) => r.description));
    if (f.work) texts.push(...f.work.stanzas.flat());
  }
  return texts.map(squash).filter(Boolean);
}

/** detail과 sources가 len자 이상 연속으로 같은 구간들 */
function sharedRuns(detail: string, sources: string[], len: number): string[] {
  const d = squash(detail);
  const hits = new Set<string>();
  for (let i = 0; i + len <= d.length; i++) {
    const w = d.slice(i, i + len);
    if (sources.some((s) => s.includes(w))) hits.add(w);
  }
  return [...hits];
}

const ITEM_REF = /\b[qQeE]\d{1,2}\b|\d+\s*번\s*(문항|질문|논점)/;

describe("강의계획서 상세 누설 검사", () => {
  it("검사기는 활동 원문을 옮긴 상세와 번호 표기를 잡는다", () => {
    const sources = activityTexts("algo101");
    const stem = getDataset("quiz-w5")!.quiz.items.find((i) => i.id === "q7")!.stem;
    expect(sharedRuns(`설명한다. ${stem.slice(0, 20)} 그리고 끝.`, sources, 15).length).toBeGreaterThan(0);
    expect(sharedRuns("전혀 다른 문장으로 쓴 계획서 상세입니다.", sources, 15)).toEqual([]);
    expect("q7에서 다룬다").toMatch(ITEM_REF);
    expect("3번 문항의 풀이").toMatch(ITEM_REF);
    expect("O(n log n)과 BFS를 비교한다").not.toMatch(ITEM_REF);
  });

  it.each(syllabi.map((s) => [s.courseId, s] as [string, Syllabus]))("%s: 상세에 문항·논점 번호가 없고 활동 원문과 15자 이상 겹치지 않는다", (_, syl) => {
    const sources = activityTexts(syl.courseId);
    expect(sources.length).toBeGreaterThan(0);
    for (const x of [...syl.concepts, ...syl.objectives]) {
      expect(x.detail, `${x.id} 상세에 번호 표기`).not.toMatch(ITEM_REF);
      expect(sharedRuns(x.detail, sources, 15), `${x.id} 상세가 활동 원문을 옮김`).toEqual([]);
      if (process.env.LEAK_REPORT) {
        const short = sharedRuns(x.detail, sources, 8);
        if (short.length > 0) console.info(`[누설 보고] ${syl.courseId}/${x.id}: ${short.map((w) => `「${w}」`).join(" ")}`);
      }
    }
  });
});
