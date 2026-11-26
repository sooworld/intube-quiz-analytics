// 첨언(forum-comment)이 인용할 사실 목록. 숫자는 모두 여기서 코드가 만들고, 첨언은 {F03} 토큰으로만 인용한다 (T7·T8).
import { formatDateTime } from "../format";
import type { DiscussionAggregate } from "./analysis";
import { SPECIAL_TARGET_LABEL, type ForumDataset } from "./types";

export type ForumFactKind = "scope" | "q-count" | "q-plan" | "special" | "overlap" | "source" | "design-gap";

export interface ForumFact {
  id: string;
  kind: ForumFactKind;
  /** 관련 하위 논점 (q-count, q-plan) 또는 new/off/hold (special) */
  focus?: string;
  text: string;
  /** 코드용 수치 (q-count: 주 배정 글 수, special: 글 수). 문장을 다시 파싱하지 않으려고 둔다 */
  count?: number;
  /** q-count: 부 배정 포함 글 수 */
  countAny?: number;
}

export interface FactInputs {
  agg: DiscussionAggregate;
  /** 교수가 확정한 글 / 규칙·AI 제안 그대로인 글 / 검토 필요(S6)라 보류로 센 글 */
  source: { teacher: number; proposed: number; review: number };
  overlapPairs: number;
  /** 교수 체크표 기준 설계 공백 목표 (체크표가 비었으면 null) */
  teacherGaps: string[] | null;
}

export function buildForumFacts(ds: ForumDataset, x: FactInputs): ForumFact[] {
  const facts: Omit<ForumFact, "id">[] = [];
  const { agg } = x;
  facts.push({
    kind: "scope",
    text: `분석 범위는 ${formatDateTime(ds.forum.opensAt)}~${formatDateTime(ds.forum.closesAt)}의 합성 글 ${agg.totalPosts}개(작성자 ${agg.totalAuthors}명, 답글 ${agg.replies}개, 스레드 ${agg.threads}개)`,
  });
  facts.push({
    kind: "source",
    text: `배정은 교수 확정 ${x.source.teacher}개, 도구 제안 그대로 ${x.source.proposed}개, 검토 필요로 보류한 글 ${x.source.review}개 기준`,
  });
  for (const q of agg.questions) {
    facts.push({
      kind: "q-count",
      focus: q.qId,
      count: q.primaryPosts,
      countAny: q.anyPosts,
      text: `${q.qId} 논점을 주 배정으로 다룬 글 ${q.primaryPosts}개(작성자 ${q.primaryAuthors}명), 부 배정까지 포함하면 ${q.anyPosts}개(작성자 ${q.anyAuthors}명)`,
    });
  }
  for (const q of ds.subQuestions) {
    facts.push({ kind: "q-plan", focus: q.id, text: `${q.id} 교수 메모(중요도 ${q.importance}, 정리 시간 예정 비중 ${Math.round(q.plannedShare * 100)}%)` });
  }
  for (const t of ["new", "off", "hold"] as const) {
    facts.push({ kind: "special", focus: t, count: agg.special[t].posts, text: `${SPECIAL_TARGET_LABEL[t]}로 분류된 글 ${agg.special[t].posts}개` });
  }
  facts.push({ kind: "overlap", text: `표현 중복 후보 쌍 ${x.overlapPairs}개(인용 제거 후 어휘 중복 기준, 원문 대조 전)` });
  if (x.teacherGaps !== null) {
    facts.push({
      kind: "design-gap",
      text: x.teacherGaps.length > 0 ? `교수 체크표에서 어떤 하위 논점도 필수로 요구하지 않는 목표: ${x.teacherGaps.join(", ")}` : "교수 체크표에서 필수로 요구되지 않는 목표 없음",
    });
  }
  return facts.map((f, i) => ({ ...f, id: `F${String(i + 1).padStart(2, "0")}` }));
}
