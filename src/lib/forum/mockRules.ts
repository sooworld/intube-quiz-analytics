// 토론 작업의 Mock(규칙 기반, AI 아님). 같은 입력에는 같은 결과를 낸다.
// 단서는 데이터(ds.mock)에 있고, 목표·Q 문장에서 기계적으로 옮긴 것이다. 그래서 규칙이 틀리는 곳이 그대로 드러난다(데모의 "도구도 틀린다").
import { INJECTION_PATTERN } from "../ai/injection";
import { COMMON, type Candidate } from "./analysis";
import { cueHits, hasCue, passageQuotes, splitSentences } from "./text";
import type { CellJudgment, ForumDataset, ResponseFunction } from "./types";

// ── 설계 지도 판정 (forum-design) ──

export interface RawDesignCell {
  objectiveId: string;
  /** Q id 또는 "common" */
  target: string;
  judgment: CellJudgment;
  /** 판정 근거로 Q 문장(공통은 안내 글)에서 옮긴 요구 문구. 무관이면 빈 문자열 */
  quote: string;
  reason: string;
}

/** 원문에서 단서가 실제로 나온 그대로의 부분 문자열 (대소문자 무시) */
function exactCue(text: string, cue: string): string | null {
  const i = text.toLowerCase().indexOf(cue.toLowerCase());
  return i < 0 ? null : text.slice(i, i + cue.length);
}

export function designMock(ds: ForumDataset): { cells: RawDesignCell[] } {
  const targets = [...ds.subQuestions.map((q) => ({ id: q.id, text: q.text })), { id: COMMON, text: ds.forum.intro }];
  const cells: RawDesignCell[] = [];
  for (const o of ds.objectives) {
    const cues = ds.mock.objectives[o.id] ?? { strong: [], weak: [] };
    for (const t of targets) {
      const strong = cues.strong.map((c) => exactCue(t.text, c)).find((x) => x !== null);
      const weak = cues.weak.map((c) => exactCue(t.text, c)).find((x) => x !== null);
      if (strong) cells.push({ objectiveId: o.id, target: t.id, judgment: "required", quote: strong, reason: `규칙: 목표의 핵심 단서 '${strong}'가 ${t.id === COMMON ? "안내 글" : "하위 논점 문장"}에 있음` });
      else if (weak) cells.push({ objectiveId: o.id, target: t.id, judgment: "optional", quote: weak, reason: `규칙: 목표의 보조 단서 '${weak}'가 ${t.id === COMMON ? "안내 글" : "하위 논점 문장"}에 있음` });
      else cells.push({ objectiveId: o.id, target: t.id, judgment: "none", quote: "", reason: "규칙: 목표 단서가 없음" });
    }
  }
  return { cells };
}

// ── 글별 근거 프로필 (forum-profile) ──

export interface RawPostProfile {
  postId: string;
  /** Q id | new | off | hold */
  primary: string;
  secondary: { qId: string; quote: string }[];
  /** 주 배정의 근거로 글에서 옮긴 문장. off·hold면 빈 문자열 */
  primaryQuote: string;
  /** primary가 new일 때만 채운다. 셋 다 있어야(대조는 하위 논점마다) 새 논점 후보로 센다 */
  newPoint: { topicLink: string; contrasts: { qId: string; reason: string }[]; statement: string };
  function: ResponseFunction | string;
  /** 응답 대상 글 id. 과제에 바로 단 글이면 빈 문자열 */
  respondsTo: string;
  rubric: { criterionId: string; quote: string }[];
  flags: string[];
}

/** 글마다 붙이는 어휘 단서 (작업 입력에 들어감) */
export interface PostHint {
  candidates: Candidate[];
  /** 부모 글과의 표현 중복(인용 제거 후 코사인). 부모가 없으면 null */
  parentOverlap: number | null;
}

/** 새 논점을 스스로 밝히는 표현 (규칙) */
const NEW_POINT_MARKERS = ["질문에는 없", "따로 다뤄", "보다 더", "새로운 문제", "다른 문제"];
const REBUT = ["동의하기 어렵", "그렇지 않", "는데, 저는", "그럴듯하지만", "기 어렵다고"];
const AGREE = ["동의합니다", "동의해요", "공감합니다", "맞습니다"];
const EXTEND = ["덧붙이면", "덧붙여", "합칠 수", "생각이 바뀌었"];
/** 반복 판정 경계 (S4 잠정값과 같은 0.5) */
const REPEAT_OVERLAP = 0.5;

export function profileMock(ds: ForumDataset, candidates: Record<string, Candidate[]>, overlaps: Record<string, number | null> = {}): { posts: RawPostProfile[] } {
  const posts = ds.posts.map((p): RawPostProfile => {
    // 지시문 문장은 근거에서 뺀다
    const sentences = splitSentences(p.text).filter((s) => !INJECTION_PATTERN.test(s.text));
    const body = sentences.map((s) => s.text).join(" ");
    const firstWith = (cues: string[]) => sentences.find((s) => cues.some((c) => hasCue(s.text, c)))?.text ?? "";
    const order = new Map((candidates[p.id] ?? []).map((c, i) => [c.qId, i]));
    const scored = ds.subQuestions
      .map((q) => ({ id: q.id, hits: cueHits(body, ds.mock.questions[q.id] ?? []).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || a.id.localeCompare(b.id));
    const onTopic = cueHits(body, ds.mock.topic).length > 0;

    let primary = "hold";
    let secondary: { qId: string; quote: string }[] = [];
    let primaryQuote = "";
    let newPoint: RawPostProfile["newPoint"] = { topicLink: "", contrasts: [], statement: "" };
    if (scored.length > 0) {
      primary = scored[0]!.id;
      secondary = scored.slice(1, 3).map((x) => ({ qId: x.id, quote: firstWith(ds.mock.questions[x.id] ?? []) }));
      primaryQuote = firstWith(ds.mock.questions[primary] ?? []);
    } else if (!onTopic) {
      primary = "off";
    } else {
      const statement = firstWith(NEW_POINT_MARKERS);
      if (statement) {
        primary = "new";
        newPoint = {
          topicLink: firstWith(ds.mock.topic),
          contrasts: ds.subQuestions.map((q) => ({ qId: q.id, reason: `규칙: ${q.id}의 단서(${(ds.mock.questions[q.id] ?? []).join(", ")})가 글에 없음` })),
          statement,
        };
        primaryQuote = statement;
      }
    }

    let fn: ResponseFunction = "new-opinion";
    if (p.parentId !== null) {
      const ov = overlaps[p.id] ?? null;
      if (ov !== null && ov >= REPEAT_OVERLAP) fn = "repeat";
      else if (firstWith(AGREE)) fn = "agree-reason";
      else if (firstWith(REBUT)) fn = "rebut";
      else if (firstWith(EXTEND)) fn = "extend";
      else if (p.text.includes("?")) fn = "question";
      else fn = "sidestep";
    }

    const rubric = ds.rubric.map((c) => {
      if (primary === "off") return { criterionId: c.id, quote: "" };
      if (c.id === "c-passage" && ds.work) {
        const s = sentences.find((x) => passageQuotes(x.text, ds.work!).length > 0);
        return { criterionId: c.id, quote: s?.text ?? "" };
      }
      return { criterionId: c.id, quote: firstWith(ds.mock.rubric[c.id] ?? []) };
    });

    const flags: string[] = [];
    if (INJECTION_PATTERN.test(p.text)) flags.push("injection-suspected");
    return { postId: p.id, primary, secondary, primaryQuote, newPoint, function: fn, respondsTo: p.parentId ?? "", rubric, flags };
  });
  return { posts };
}
