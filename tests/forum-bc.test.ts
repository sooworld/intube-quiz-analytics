import { describe, expect, it } from "vitest";
import { INTENT, PAIRS } from "../scripts/forum-bc/gold";
import { VARIANTS } from "../scripts/forum-bc/variants";
import { forumCommentTask, validateForumComment } from "../src/lib/ai/tasks/forumComment";
import { forumDesignTask, validateForumDesign } from "../src/lib/ai/tasks/forumDesign";
import { forumProfileTask, mergeProfileResults, splitProfileInput, validateForumProfile, type ForumProfileResult } from "../src/lib/ai/tasks/forumProfile";
import { isAiDraft } from "../src/lib/state/aiRecords";
import { aggregate, COMMON, designGaps, diffChecklists, isComplete, lexicalCandidates, overlapCandidates, parentOverlaps } from "../src/lib/forum/analysis";
import { FORUM_F5 } from "../src/lib/forum/content/f5";
import { FORUM_LIT_F3 } from "../src/lib/forum/content/litF3";
import { buildForumFacts } from "../src/lib/forum/facts";
import { designInput, profileInput } from "../src/lib/forum/inputs";
import { decide, emptyAssignments, exampleChecklist, finalAssignments, restoreAssignments, restoreChecklist, setCell, sourceMix } from "../src/lib/forum/state";
import { isInWork, passageQuotes, splitSentences, stripQuoted } from "../src/lib/forum/text";
import type { ForumDataset } from "../src/lib/forum/types";

const FORUMS: ForumDataset[] = [FORUM_F5, FORUM_LIT_F3];
const work = FORUM_LIT_F3.work!;
const post = (ds: ForumDataset, id: string) => ds.posts.find((p) => p.id === id)!;

describe("토론 합성 자료 무결성", () => {
  it.each(FORUMS.map((ds) => [ds.forum.id, ds] as const))("%s: 글 id가 겹치지 않고, 부모 글이 먼저 있다", (_, ds) => {
    const ids = ds.posts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [i, p] of ds.posts.entries()) if (p.parentId) expect(ids.slice(0, i)).toContain(p.parentId);
  });

  it.each(FORUMS.map((ds) => [ds.forum.id, ds] as const))("%s: 의도 라벨이 모든 글을 덮고, 쌍·변형의 글이 있다", (_, ds) => {
    expect(Object.keys(INTENT[ds.forum.id]!).sort()).toEqual(ds.posts.map((p) => p.id).sort());
    for (const pr of PAIRS[ds.forum.id]!) {
      expect(ds.posts.some((p) => p.id === pr.a)).toBe(true);
      expect(ds.posts.some((p) => p.id === pr.b)).toBe(true);
    }
    const vs = VARIANTS.filter((v) => v.forumId === ds.forum.id);
    expect(vs).toHaveLength(6);
    expect(new Set(vs.map((v) => v.kind)).size).toBe(6);
  });

  it("체크표 예시와 공통 요건은 있는 목표·열만 쓴다", () => {
    for (const ds of FORUMS) {
      const ok = new Set(ds.objectives.flatMap((o) => ds.subQuestions.map((q) => `${o.id}|${q.id}`)));
      for (const k of Object.keys(ds.exampleChecklist)) expect(ok.has(k)).toBe(true);
      for (const k of Object.keys(ds.commonRequirements)) expect(ds.objectives.some((o) => o.id === k)).toBe(true);
    }
  });
});

describe("텍스트 도구", () => {
  it("문장을 나누되 큰따옴표 안의 마침표에서는 자르지 않는다", () => {
    const s = splitSentences('그는 "가라. 가라." 하고 말했다. 끝이다.');
    expect(s.map((x) => x.text)).toEqual(['그는 "가라. 가라." 하고 말했다.', "끝이다."]);
    expect(s[1]!.start).toBe('그는 "가라. 가라." 하고 말했다. '.length);
  });

  it("작품 구절 대조: 여러 행에 걸친 인용과 어미 조각은 있다고 보고, 바꿔 쓴 첫 행은 없다고 본다", () => {
    expect(isInWork("영변에 약산 / 진달래꽃", work)).toBe(true);
    expect(isInWork("-우리다", work)).toBe(true);
    expect(isInWork("나 보기가 싫어서 가실 때에는", work)).toBe(false);
  });

  it("작은따옴표 대사('난 괜찮아')는 구절 검사에서 빼고, 바꿔 쓴 구절은 걸린다(규칙의 한계)", () => {
    expect(passageQuotes(post(FORUM_LIT_F3, "c06").text, work)).toEqual([]);
    const c08 = passageQuotes(post(FORUM_LIT_F3, "c08").text, work);
    expect(c08.filter((q) => !q.inWork).map((q) => q.quote)).toContain("나 보기가 싫어서 가실 때에는");
    const c13 = passageQuotes(post(FORUM_LIT_F3, "c13").text, work).filter((q) => !q.inWork).map((q) => q.quote);
    expect(c13).toEqual(["눈물 흘리지 않으리다"]);
  });

  it("인용 제거는 큰따옴표 안과 작품 행을 지운다", () => {
    expect(stripQuoted('저는 "말없이 고이 보내 드리우리다"를 봅니다', work)).toBe("저는 를 봅니다");
    expect(stripQuoted("가실 때에는 슬프다", work)).toBe("슬프다");
  });
});

describe("분석 계산", () => {
  it("어휘 후보는 결정적이고 내림차순이다", () => {
    const a = lexicalCandidates(FORUM_F5);
    const b = lexicalCandidates(FORUM_F5);
    expect(a).toEqual(b);
    for (const c of Object.values(a)) for (let i = 1; i < c.length; i++) expect(c[i - 1]!.cosine).toBeGreaterThanOrEqual(c[i]!.cosine);
  });

  it("설계자 예시 체크표의 설계 공백은 두 과제 모두 O3다 (b0-prereg §4)", () => {
    for (const ds of FORUMS) {
      const g = designGaps(ds, exampleChecklist(ds, "2026-11-26T00:00:00Z").cells);
      expect(g.uncoveredObjectives).toEqual(["O3"]);
      expect(g.unlinkedQuestions).toEqual([]);
    }
  });

  it("체크표 비교는 다른 칸만 낸다", () => {
    const a = { "O1|Q1": "required" as const };
    const b = { "O1|Q1": "optional" as const, [`O2|${COMMON}`]: "required" as const };
    expect(diffChecklists(FORUM_F5, a, b)).toEqual([
      { objectiveId: "O1", target: "Q1", a: "required", b: "optional" },
      { objectiveId: "O2", target: COMMON, a: "unset", b: "required" },
    ]);
  });

  it("미검토 칸이 있으면 공백이라 하지 않고 \"아직 모름\"으로 둔다", () => {
    const g = designGaps(FORUM_F5, { "O1|Q1": "required", "O3|Q1": "none" });
    expect(g.uncoveredObjectives).toEqual([]);
    expect(g.pendingObjectives).toEqual(["O2", "O3", "O4", "O5"]);
    expect(isComplete(FORUM_F5, exampleChecklist(FORUM_F5, "t").cells)).toBe(true);
  });

  it("집계: 주 배정과 부 배정 포함 수, 작성자 수를 따로 센다", () => {
    const agg = aggregate(FORUM_F5, [
      { postId: "b01", primary: "Q2", secondary: ["Q1"] },
      { postId: "b18", primary: "Q2", secondary: [] },
      { postId: "b03", primary: "Q1", secondary: [] },
      { postId: "b12", primary: "new", secondary: [] },
    ]);
    const q1 = agg.questions.find((q) => q.qId === "Q1")!;
    const q2 = agg.questions.find((q) => q.qId === "Q2")!;
    expect(q2).toMatchObject({ primaryPosts: 2, primaryAuthors: 1, anyPosts: 2 }); // b01·b18은 같은 작성자
    expect(q1).toMatchObject({ primaryPosts: 1, anyPosts: 2, anyAuthors: 2 });
    expect(agg.special.new.posts).toBe(1);
    expect(agg.unassigned).toBe(FORUM_F5.posts.length - 4);
  });

  it("표현 중복 후보(인용 제거, 0.5)는 복사 쌍만 잡는다", () => {
    expect(overlapCandidates(FORUM_F5).map((p) => [p.a, p.b])).toEqual([["b01", "b09"]]);
    expect(overlapCandidates(FORUM_LIT_F3).map((p) => [p.a, p.b])).toEqual([["c01", "c07"]]);
    const ov = parentOverlaps(FORUM_F5);
    expect(ov.b01).toBeNull();
    expect(ov.b09).toBeGreaterThan(0.5);
  });
});

describe("교수 기록", () => {
  it("칸을 바꾸면 예시 출처가 '예시를 고침'으로 바뀐다", () => {
    const ex = exampleChecklist(FORUM_F5, "t0");
    const next = setCell(ex, "O3|Q4", "required", "t1");
    expect(next.source).toBe("example-edited");
    expect(next.cells["O3|Q4"]).toBe("required");
    expect(restoreChecklist(next, FORUM_F5)).not.toBeNull();
    expect(restoreChecklist({ ...next, dataVersion: "old" }, FORUM_F5)).toBeNull();
    expect(restoreChecklist({ ...next, cells: { "O9|Q1": "required" } }, FORUM_F5)).toBeNull();
  });

  it("부 배정은 하위 논점 주 배정일 때만, 최대 두 개", () => {
    let s = emptyAssignments(FORUM_F5.dataVersion);
    s = decide(s, "b01", { primary: "Q2", secondary: ["Q1", "Q3", "Q4", "Q2"] }, null, null, "t");
    expect(s.decisions.b01!.secondary).toEqual(["Q1", "Q3"]);
    s = decide(s, "b12", { primary: "new", secondary: ["Q1"] }, null, null, "t");
    expect(s.decisions.b12!.secondary).toEqual([]);
    const bad = { ...s, decisions: { ...s.decisions, b01: { ...s.decisions.b01!, secondary: ["Q1", "Q3", "Q4"] } } };
    expect(restoreAssignments(bad, FORUM_F5)).toBeNull();
  });

  it("확정할 때 도구 제안을 봤는지 기록한다(자동화 편향 측정용)", () => {
    let s = emptyAssignments(FORUM_F5.dataVersion);
    s = decide(s, "b04", { primary: "Q1", secondary: [] }, { primary: "hold", secondary: [] }, "dr-1", "t1", false);
    expect(s.decisions.b04!.sawProposal).toBe(false);
    expect(restoreAssignments(s, FORUM_F5)).not.toBeNull();
    expect(restoreAssignments({ ...s, decisions: { b04: { ...s.decisions.b04!, sawProposal: "x" } } }, FORUM_F5)).toBeNull();
  });

  it("확정은 도구 제안과 따로 저장되고, 바꾼 이력이 남는다", () => {
    let s = emptyAssignments(FORUM_F5.dataVersion);
    const proposal = { primary: "hold" as const, secondary: [] };
    s = decide(s, "b04", { primary: "Q1", secondary: [] }, proposal, "dr-1", "t1");
    s = decide(s, "b04", { primary: "Q1", secondary: ["Q4"] }, proposal, "dr-1", "t2");
    s = decide(s, "b04", null, proposal, "dr-1", "t3");
    expect(s.decisions).toEqual({});
    expect(s.log.map((e) => [e.from?.primary ?? null, e.to?.primary ?? null])).toEqual([
      ["hold", "Q1"],
      ["Q1", "Q1"],
      ["Q1", null],
    ]);
    expect(restoreAssignments(s, FORUM_F5)).not.toBeNull();
  });

  it("검토 필요 글은 교수가 확정하기 전까지 판단 보류로 센다", () => {
    const input = profileInput(FORUM_F5);
    const res = validateForumProfile(forumProfileTask.mock(input), input);
    const tampered: ForumProfileResult = { ...res, posts: res.posts.map((p) => (p.postId === "b03" ? { ...p, issues: ["x"] } : p)) };
    const fin = finalAssignments(FORUM_F5, tampered.posts, {});
    expect(fin.find((f) => f.postId === "b03")).toMatchObject({ primary: "hold", source: "review" });
    const fin2 = finalAssignments(FORUM_F5, tampered.posts, { b03: { primary: "Q1", secondary: [], proposal: null, basedOnDraftId: null, decidedAt: "t" } });
    expect(fin2.find((f) => f.postId === "b03")).toMatchObject({ primary: "Q1", source: "teacher" });
    expect(sourceMix(fin2).teacher).toBe(1);
  });
});

describe("forum-design 작업", () => {
  it.each(FORUMS.map((ds) => [ds.forum.id, ds] as const))("%s: Mock 결과는 모든 칸을 내고 검증을 통과한다", (_, ds) => {
    const input = designInput(ds);
    const r = validateForumDesign(forumDesignTask.mock(input), input);
    expect(r.status).toBe("valid");
    expect(r.cells).toHaveLength(ds.objectives.length * (ds.subQuestions.length + 1));
  });

  it("규칙은 '관련'을 '요구'로 읽는 오류를 그대로 낸다: B형 O3×Q2(다양성 의무)를 필수로", () => {
    const input = designInput(FORUM_F5);
    const r = validateForumDesign(forumDesignTask.mock(input), input);
    expect(r.cells.find((c) => c.objectiveId === "O3" && c.target === "Q2")?.judgment).toBe("required");
  });

  it("무관인데 인용이 있으면 검토 필요", () => {
    const input = designInput(FORUM_F5);
    const raw = forumDesignTask.mock(input) as { cells: { objectiveId: string; target: string; quote: string; judgment: string }[] };
    const bad = { cells: raw.cells.map((c) => (c.objectiveId === "O5" && c.target === "Q1" ? { ...c, judgment: "none", quote: "지어낸 문구" } : c)) };
    const r = validateForumDesign(bad, input);
    expect(r.cells.find((c) => c.objectiveId === "O5" && c.target === "Q1")?.issues).toEqual(["quote-on-none"]);
  });

  it("인용이 하위 논점 문장에 없으면 검토 필요, 칸이 빠지면 무효", () => {
    const input = designInput(FORUM_F5);
    const raw = forumDesignTask.mock(input) as { cells: { objectiveId: string; target: string; quote: string; judgment: string }[] };
    const bad = { cells: raw.cells.map((c) => (c.objectiveId === "O1" && c.target === "Q1" ? { ...c, judgment: "required", quote: "없는 문구" } : c)) };
    const r = validateForumDesign(bad, input);
    expect(r.status).toBe("needs-review");
    expect(r.cells.find((c) => c.objectiveId === "O1" && c.target === "Q1")?.issues).toEqual(["quote-mismatch"]);
    expect(validateForumDesign({ cells: raw.cells.slice(1) }, input).status).toBe("invalid");
  });

  it("프롬프트는 데이터를 구분자 안에 넣고, 스키마는 모든 속성이 필수다", () => {
    const input = designInput(FORUM_F5);
    const p = forumDesignTask.buildPrompt(input);
    expect(p.user).toContain("<objectives>");
    expect(p.system).toContain("관련 있다");
    const s = forumDesignTask.schema(input) as { properties: { cells: { items: { required: string[] } } } };
    expect(s.properties.cells.items.required).toEqual(["objectiveId", "target", "judgment", "quote", "reason"]);
  });
});

describe("forum-profile 작업", () => {
  it.each(FORUMS.map((ds) => [ds.forum.id, ds] as const))("%s: Mock은 결정적이고, 모든 글을 낸다", (_, ds) => {
    const input = profileInput(ds);
    expect(forumProfileTask.mock(input)).toEqual(forumProfileTask.mock(input));
    const r = validateForumProfile(forumProfileTask.mock(input), input);
    expect(r.status).not.toBe("invalid");
    expect(r.posts.map((p) => p.postId)).toEqual(ds.posts.map((p) => p.id));
  });

  it("코드가 지시문과 작품에 없는 인용을 직접 표시한다", () => {
    const b = profileInput(FORUM_F5);
    const rb = validateForumProfile(forumProfileTask.mock(b), b);
    expect(rb.posts.find((p) => p.postId === "b16")?.flags).toContain("injection-suspected");
    const c = profileInput(FORUM_LIT_F3);
    const rc = validateForumProfile(forumProfileTask.mock(c), c);
    expect(rc.posts.find((p) => p.postId === "c08")?.notInWork).toContain("나 보기가 싫어서 가실 때에는");
    expect(rc.posts.find((p) => p.postId === "c16")?.flags).toContain("injection-suspected");
  });

  it("주제 이탈 글의 루브릭은 해당 없음, 근거 없는 기준은 미확인", () => {
    const c = profileInput(FORUM_LIT_F3);
    const rc = validateForumProfile(forumProfileTask.mock(c), c);
    const c18 = rc.posts.find((p) => p.postId === "c18")!;
    expect(c18.primary).toBe("off");
    expect(c18.rubric.every((r) => r.state === "na")).toBe(true);
  });

  it("S6: 글에 없는 근거 문장, 부모가 아닌 응답 대상은 검토 필요", () => {
    const input = profileInput(FORUM_F5);
    const raw = forumProfileTask.mock(input) as { posts: Record<string, unknown>[] };
    const bad = {
      posts: raw.posts.map((p) => (p.postId === "b02" ? { ...p, primaryQuote: "지어낸 문장입니다.", respondsTo: "b03" } : p)),
    };
    const r = validateForumProfile(bad, input);
    expect(r.status).toBe("needs-review");
    const b02 = r.posts.find((p) => p.postId === "b02")!;
    expect(b02.issues.some((i) => i.includes("글에 없습니다"))).toBe(true);
    expect(b02.issues.some((i) => i.includes("응답 대상"))).toBe(true);
  });

  it("새 논점은 세 근거가 모두 있어야 하고, 하나라도 없으면 판단 보류로 바꾼다", () => {
    const input = profileInput(FORUM_F5);
    const raw = forumProfileTask.mock(input) as { posts: Record<string, unknown>[] };
    const bad = { posts: raw.posts.map((p) => (p.postId === "b14" ? { ...p, primary: "new", primaryQuote: "", newPoint: { topicLink: "", noMatch: "x", statement: "" } } : p)) };
    const r = validateForumProfile(bad, input);
    const b14 = r.posts.find((p) => p.postId === "b14")!;
    expect(b14.primary).toBe("hold");
    expect(b14.notes[0]).toContain("판단 보류");
    expect(b14.issues).toEqual([]);
  });

  it("부 배정은 근거 문장이 글에 있어야 하고, 특수 배정이면 비운다", () => {
    const input = profileInput(FORUM_F5);
    const raw = forumProfileTask.mock(input) as { posts: Record<string, unknown>[] };
    const bad = {
      posts: raw.posts.map((p) =>
        p.postId === "b01" ? { ...p, secondary: [{ qId: "Q1", quote: "지어낸 문장" }] } : p.postId === "b14" ? { ...p, secondary: [{ qId: "Q1", quote: "" }] } : p,
      ),
    };
    const r = validateForumProfile(bad, input);
    const b01 = r.posts.find((p) => p.postId === "b01")!;
    expect(b01.secondary).toEqual([]);
    expect(b01.issues.some((i) => i.includes("부 배정 Q1"))).toBe(true);
    const b14 = r.posts.find((p) => p.postId === "b14")!;
    expect(b14.secondary).toEqual([]);
    expect(b14.issues).toEqual([]);
  });

  it("새 논점은 모든 하위 논점의 대조 이유가 있어야 한다 (문자열 채우기로 통과하지 않음)", () => {
    const input = profileInput(FORUM_F5);
    const raw = forumProfileTask.mock(input) as { posts: Record<string, unknown>[] };
    const text = FORUM_F5.posts.find((p) => p.id === "b01")!.text;
    const fake = { primary: "new", primaryQuote: text, newPoint: { topicLink: text, contrasts: [{ qId: "Q1", reason: "x" }], statement: text } };
    const r = validateForumProfile({ posts: raw.posts.map((p) => (p.postId === "b01" ? { ...p, ...fake } : p)) }, input);
    expect(r.posts.find((p) => p.postId === "b01")?.primary).toBe("hold");
    const c = profileInput(FORUM_LIT_F3);
    const rc = validateForumProfile(forumProfileTask.mock(c), c);
    const c09 = rc.posts.find((p) => p.postId === "c09")!;
    expect(c09.primary).toBe("new");
    expect(c09.newPoint?.contrasts.map((x) => x.qId)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  it("과제에 바로 단 글의 기능은 새 의견으로 고친다", () => {
    const input = profileInput(FORUM_F5);
    const raw = forumProfileTask.mock(input) as { posts: Record<string, unknown>[] };
    const r = validateForumProfile({ posts: raw.posts.map((p) => (p.postId === "b01" ? { ...p, function: "rebut" } : p)) }, input);
    expect(r.posts.find((p) => p.postId === "b01")?.function).toBe("new-opinion");
  });

  it("실제 모델용 나눠 부르기: 6개씩 나누고, 묶음별 검증을 합치면 한 번에 검증한 것과 같다", () => {
    const input = profileInput(FORUM_F5);
    const parts = splitProfileInput(input);
    expect(parts.map((p) => p.posts.length)).toEqual([6, 6, 6]);
    expect(Object.keys(parts[1]!.hints).sort()).toEqual(parts[1]!.posts.map((p) => p.id).sort());
    const whole = validateForumProfile(forumProfileTask.mock(input), input);
    const merged = mergeProfileResults(parts.map((p) => validateForumProfile(forumProfileTask.mock(p), p)));
    expect(merged.posts).toEqual(whole.posts);
    expect(merged.status).toBe(whole.status);
    expect(mergeProfileResults([merged, { status: "invalid", posts: [], problems: ["x"] }]).status).toBe("invalid");
    // 다른 묶음의 부모 글은 본문을 문맥으로 넘기고, 프롬프트에 들어가되 배정 대상(스키마 enum)은 아니다
    const b3 = parts[2]!;
    expect(b3.context?.map((c) => c.id)).toEqual(["b12", "b03", "b02"]);
    expect(forumProfileTask.buildPrompt(b3).user).toContain("<context>");
    const s = forumProfileTask.schema(b3) as { properties: { posts: { items: { properties: { postId: { enum: string[] } } } } } };
    expect(s.properties.posts.items.properties.postId.enum).toEqual(b3.posts.map((p) => p.id));
  });

  it("작성자 이름은 프롬프트에 넣지 않는다", () => {
    const input = profileInput(FORUM_F5);
    const p = forumProfileTask.buildPrompt(input);
    for (const post of FORUM_F5.posts) expect(p.user).not.toContain(post.author);
  });

  it("중복 글이나 없는 글 id는 무효", () => {
    const input = profileInput(FORUM_F5);
    const raw = forumProfileTask.mock(input) as { posts: Record<string, unknown>[] };
    expect(validateForumProfile({ posts: [...raw.posts, raw.posts[0]] }, input).status).toBe("invalid");
    expect(validateForumProfile({ posts: [{ ...raw.posts[0], postId: "zz" }] }, input).status).toBe("invalid");
  });
});

describe("forum-comment 작업", () => {
  const factsFor = (ds: ForumDataset) => {
    const input = profileInput(ds);
    const res = validateForumProfile(forumProfileTask.mock(input), input);
    const fin = finalAssignments(ds, res.posts, {});
    return buildForumFacts(ds, { agg: aggregate(ds, fin), source: sourceMix(fin), overlapPairs: overlapCandidates(ds).length, teacherGaps: ["O3"] });
  };

  it.each(FORUMS.map((ds) => [ds.forum.id, ds] as const))("%s: Mock 첨언은 형식·숫자·진단어·재배분 규칙을 통과한다", (_, ds) => {
    const facts = factsFor(ds);
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `F${String(i + 1).padStart(2, "0")}`));
    const input = { forumId: ds.forum.id, facts };
    const r = validateForumComment(forumCommentTask.mock(input), input);
    expect(r.problems).toEqual([]);
    expect(r.status).toBe("valid");
    expect(r.items.length).toBeGreaterThan(0);
  });

  it("Mock 첫 첨언은 부 포함 글이 가장 적은 논점, 같으면 주 배정이 더 적은 논점을 본다", () => {
    const facts = factsFor(FORUM_F5);
    const counts = facts.filter((f) => f.kind === "q-count").map((f) => [f.focus, f.countAny, f.count]);
    const minAny = Math.min(...counts.map((c) => c[1] as number));
    const cands = counts.filter((c) => c[1] === minAny).sort((x, y) => (x[2] as number) - (y[2] as number));
    const raw = forumCommentTask.mock({ forumId: "f5", facts }) as { items: { focus: string }[] };
    expect(raw.items[0]!.focus).toBe(cands[0]![0]);
  });

  it("토큰 밖 숫자, 진단어, 교수 메모 없는 시간 질문은 검토 필요", () => {
    const facts = factsFor(FORUM_F5);
    const input = { forumId: "f5", facts };
    const item = { focus: "Q3", observation: "{F03}입니다.", interpretation: "학생들의 비판적 사고가 부족합니다.", alternative: "3개 글이 더 있습니다.", holdCondition: "확인 전입니다.", question: "다음 수업에서 이 논점에 시간을 더 쓰시겠습니까?" };
    const r = validateForumComment({ items: [item] }, input);
    expect(r.status).toBe("needs-review");
    expect(r.items[0]!.issues.sort()).toEqual(["diagnostic-term", "number-outside-token", "plan-missing"]);
  });

  it("관찰은 사실 칩 위주여야 하고, 다른 논점의 교수 메모를 끌어 쓰면 검토 필요", () => {
    const facts = factsFor(FORUM_F5);
    const plan = (q: string) => facts.find((f) => f.kind === "q-plan" && f.focus === q)!.id;
    const count = facts.find((f) => f.kind === "q-count" && f.focus === "Q1")!.id;
    const input = { forumId: "f5", facts };
    const item = {
      focus: "Q1",
      observation: `{${count}}입니다. 그런데 이 사실은 실제로는 학생들이 이 논점을 제대로 다루지 않았다는 뜻입니다.`,
      interpretation: "추정입니다.",
      alternative: "배정이 틀렸을 수 있습니다.",
      holdCondition: "확인 전입니다.",
      question: `다음 수업 시간을 늘릴지 {${plan("Q4")}}를 보고 정하시겠습니까?`,
    };
    const r = validateForumComment({ items: [item] }, input);
    expect(r.items[0]!.issues.sort()).toEqual(["observation-free-text", "plan-mismatch"]);
  });

  it("사실 목록에 있는 하위 논점·목표 이름(Q1, O3)의 숫자만 예외로 보고, 글 id·없는 이름·수량 단위는 잡는다", () => {
    const facts = factsFor(FORUM_F5);
    const count = facts.find((f) => f.kind === "q-count" && f.focus === "Q1")!.id;
    const item = { focus: "Q1", observation: `Q1은 {${count}}이다.`, interpretation: "Q1과 O3이 이어질 수 있다는 추정입니다.", alternative: "일부 글의 배정이 틀렸을 수 있습니다.", holdCondition: "확인 전입니다.", question: "Q1을 확인하시겠습니까?" };
    expect(validateForumComment({ items: [item] }, { forumId: "f5", facts }).items[0]!.issues).toEqual([]);
    expect(validateForumComment({ items: [{ ...item, question: "Q1 배정 기준을 확인하시겠습니까?" }] }, { forumId: "f5", facts }).items[0]!.issues).toEqual([]);
    expect(validateForumComment({ items: [{ ...item, question: "F07의 예정 비중을 볼까요?" }] }, { forumId: "f5", facts }).items[0]!.issues).toEqual(["bare-fact-id"]);
    for (const alternative of ["글 3개가 더 있습니다.", "b07의 배정이 틀렸을 수 있습니다.", "Q9를 봅니다.", "Q1%가 늘었습니다."]) {
      expect(validateForumComment({ items: [{ ...item, alternative }] }, { forumId: "f5", facts }).items[0]!.issues).toEqual(["number-outside-token"]);
    }
  });

  it("사실 목록에 없는 토큰이나 빈 칸은 무효 (S6)", () => {
    const facts = factsFor(FORUM_F5);
    const input = { forumId: "f5", facts };
    const base = { focus: "Q1", observation: "{F99}입니다.", interpretation: "a", alternative: "b", holdCondition: "c", question: "d?" };
    expect(validateForumComment({ items: [base] }, input).status).toBe("invalid");
    expect(validateForumComment({ items: [{ ...base, observation: "{F01}입니다.", question: "" }] }, input).status).toBe("invalid");
  });
});

describe("초안 저장 계약", () => {
  it("토론 작업 초안도 저장소 복원 검사를 통과한다", () => {
    const input = designInput(FORUM_F5);
    const d = {
      draftId: "dr-1",
      task: "forum-design",
      quizId: "f5",
      dataVersion: FORUM_F5.dataVersion,
      provider: "mock",
      requestedModel: "rules-v1",
      responseModel: "rules-v1",
      promptVersion: "forum-design-v1",
      schemaVersion: "1",
      validatorVersion: "1",
      basisHash: "h",
      input,
      createdAt: "2026-11-26T00:00:00Z",
      result: validateForumDesign(forumDesignTask.mock(input), input),
    };
    expect(isAiDraft(d)).toBe(true);
  });
});

describe("forum-comment v3 (관찰은 사실 id 목록)", () => {
  it("관찰 사실 id로 관찰 문장을 만들고, 없는 id는 스키마·검증에서 막는다", () => {
    const input = profileInput(FORUM_F5);
    const res = validateForumProfile(forumProfileTask.mock(input), input);
    const fin = finalAssignments(FORUM_F5, res.posts, {});
    const facts = buildForumFacts(FORUM_F5, { agg: aggregate(FORUM_F5, fin), source: sourceMix(fin), overlapPairs: 1, teacherGaps: ["O3"] });
    const ci = { forumId: "f5", facts };
    const schema = forumCommentTask.schema(ci) as { properties: { items: { items: { properties: { observationFacts: { items: { enum: string[] } } }; required: string[] } } } };
    expect(schema.properties.items.items.properties.observationFacts.items.enum).toEqual(facts.map((f) => f.id));
    expect(schema.properties.items.items.required).not.toContain("observation");
    const base = { focus: "Q1", interpretation: "추정입니다.", alternative: "배정이 틀렸을 수 있습니다.", holdCondition: "확인 전입니다.", question: "확인하시겠습니까?" };
    const ok = validateForumComment({ items: [{ ...base, observationFacts: ["F03", "F03", "F07"] }] }, ci);
    expect(ok.status).toBe("valid");
    expect(ok.items[0]!.fields.observation).toBe("{F03} {F07}");
    expect(validateForumComment({ items: [{ ...base, observationFacts: ["F99"] }] }, ci).status).toBe("invalid");
    expect(validateForumComment({ items: [{ ...base, observationFacts: [] }] }, ci).status).toBe("invalid");
  });
});
