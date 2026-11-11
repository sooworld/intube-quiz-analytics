// 결과 요약의 사실 목록 (docs/decisions.md §8.4). 숫자가 든 문장은 모두 여기서 코드가 만든다.
// AI는 사실 id({F03})를 골라 문장을 잇기만 한다. 학생 이름·id는 넣지 않는다(인원만).
import { pct } from "../format";
import type { Concept, QMatrix } from "../types";
import { classConcept } from "./concepts";
import { conceptGroups, conceptGroupSensitivity, DEFAULT_THRESHOLD, EXPLORE_LABEL } from "./groups";
import { allItemStats } from "./itemStats";
import type { ResponseMatrix } from "./matrix";
import { overlapTable, RELATION_LABEL, type RelationLike } from "./relations";

export type FactKind =
  | "attempts"
  | "concept-wrong"
  | "concept-extreme"
  | "item-facility"
  | "misconception"
  | "discrimination-na"
  | "unanswered"
  | "concept-group"
  | "group-sensitivity"
  | "untagged"
  | "overlap"
  | "saved-group"
  // 서술형 (src/lib/essay/facts.ts, 확정 점수만)
  | "essay-confirmation"
  | "essay-final-source"
  | "essay-concept-rate"
  | "essay-concept-extreme"
  | "essay-criterion-dist"
  | "essay-criterion-extreme"
  | "essay-ai-agreement"
  | "essay-submission-flags";

export interface Fact {
  /** F01, F02, … (입력이 같으면 같은 순서) */
  id: string;
  kind: FactKind;
  /** 화면과 복사에 쓰는 사실 절. 주체·지표·분모를 포함한다 */
  text: string;
  numerator: number | null;
  denominator: number | null;
}

/** 저장된 교수 그룹안 중 요약에 필요한 부분 (QuizContext.GroupDecision과 같은 모양) */
export interface SavedGroupsView {
  status: "saved" | "deferred" | "rejected";
  mode: string;
  settings: { threshold?: number };
  reason?: string;
  groups: { name: string; studentIds: string[] }[];
}

const MODE_LABEL: Record<string, string> = { concept: "개념별", cluster: EXPLORE_LABEL.cluster, density: EXPLORE_LABEL.density, bundle: "개념 묶음", none: "그룹화 안 함" };

/** 정답률이 이 값보다 낮은 문항을 사실로 올린다(최대 3개) */
const LOW_FACILITY = 0.6;
/** 응시 인원 중 이 비율 이상이 고른 오개념 후보 선택지를 사실로 올린다(최대 3개) */
const MISCONCEPTION_SHARE = 0.2;

const ratio = (n: number, d: number) => `${pct(d > 0 ? n / d : null)}(${n}/${d})`;

export function buildAnalysisFacts(
  m: ResponseMatrix,
  q: QMatrix,
  concepts: Concept[],
  relations: RelationLike[],
  saved: SavedGroupsView | null,
  threshold = DEFAULT_THRESHOLD,
): Fact[] {
  const facts: Omit<Fact, "id">[] = [];
  const add = (kind: FactKind, text: string, numerator: number | null = null, denominator: number | null = null) => facts.push({ kind, text, numerator, denominator });
  const n = m.students.length;
  const total = n + m.notAttempted.length;
  const name = new Map(concepts.map((c) => [c.id, c.name]));
  const num = new Map(m.items.map((i) => [i.id, i.number]));

  add("attempts", `응시 완료 ${n}명(전체 ${total}명 중, 미응시 ${m.notAttempted.length}명)`, n, total);
  if (n === 0) return facts.map((f, i) => ({ ...f, id: factId(i) }));

  // 개념별 학급 관찰 오답률
  const cls = concepts.map((c) => ({ c, v: classConcept(m, q, c.id) }));
  for (const { c, v } of cls) {
    if (v.denominator === 0) add("concept-wrong", `${c.name}: 태그 문항이 없어 학급 관찰 오답률 자료 없음`);
    else add("concept-wrong", `${c.name} 학급 관찰 오답률 ${ratio(v.numerator, v.denominator)}`, v.numerator, v.denominator);
  }
  // 비교 사실: 가장 높은·낮은 개념 (동률 표시). 비교는 이 사실로만 쓸 수 있다
  const valued = cls.filter((x) => x.v.value !== null);
  if (valued.length >= 2) {
    for (const [label, pick] of [["가장 높은", Math.max], ["가장 낮은", Math.min]] as const) {
      const target = pick(...valued.map((x) => x.v.value!));
      const tied = valued.filter((x) => Math.abs(x.v.value! - target) < 1e-12);
      const body = tied.map((x) => `${x.c.name} ${ratio(x.v.numerator, x.v.denominator)}`).join(", ");
      add("concept-extreme", `학급 관찰 오답률이 ${label} 개념${tied.length > 1 ? "(동률)" : ""}: ${body}`);
    }
  }

  const stats = allItemStats(m);
  // 정답률이 낮은 문항
  for (const s of [...stats].filter((s) => s.facility.value !== null && s.facility.value < LOW_FACILITY).sort((a, b) => a.facility.value! - b.facility.value! || num.get(a.itemId)! - num.get(b.itemId)!).slice(0, 3)) {
    add("item-facility", `Q${num.get(s.itemId)} 정답률 ${ratio(s.facility.numerator, s.facility.denominator)}`, s.facility.numerator, s.facility.denominator);
  }
  // 많이 고른 오개념 후보
  const mis: { itemId: string; label: string; what: string; count: number }[] = [];
  for (const s of stats) {
    for (const o of s.options ?? []) if (!o.isCorrect && o.misconception) mis.push({ itemId: s.itemId, label: o.misconception, what: `오답 선택지 ${o.optionId}`, count: o.count });
    for (const g of s.shortGroups ?? []) if (!g.correct && g.misconception) mis.push({ itemId: s.itemId, label: g.misconception, what: "오답 답안 묶음", count: g.count });
  }
  for (const x of mis.filter((x) => x.count / n >= MISCONCEPTION_SHARE).sort((a, b) => b.count - a.count || num.get(a.itemId)! - num.get(b.itemId)!).slice(0, 3)) {
    add("misconception", `Q${num.get(x.itemId)} ${x.what}(오개념 후보: ${x.label}) ${x.count}명(응시 ${n}명 중 ${pct(x.count / n)})`, x.count, n);
  }
  // 변별도 계산 불가
  const naItems = stats.filter((s) => s.discrimination === null).map((s) => `Q${num.get(s.itemId)}`);
  if (naItems.length > 0) add("discrimination-na", `변별도 계산 불가 문항 ${naItems.length}개(${naItems.join(", ")}): 문항 점수나 나머지 점수에 차이가 없음`);
  // 무응답
  const unanswered = stats.reduce((sum, s) => sum + s.unanswered, 0);
  if (unanswered > 0) add("unanswered", `무응답 ${unanswered}건(응답 칸 ${n * m.items.length}개 중)`, unanswered, n * m.items.length);

  // 개념 보충 그룹 (기준 고정, 계산 그룹)
  const th = `관찰 오답률 ${pct(threshold)} 이상`;
  for (const g of conceptGroups(m, q, concepts, threshold)) {
    if (!g.hasEvidence) continue;
    add("concept-group", `${name.get(g.conceptId)} 보충 대상(계산 그룹, ${th}) ${g.members.length}명(응시 ${n}명 중)`, g.members.length, n);
  }
  const sens = conceptGroupSensitivity(m, q, concepts, threshold);
  if (sens.max > 0) {
    const at = sens.perItem.filter((p) => p.changed === sens.max).map((p) => `Q${num.get(p.itemId)}`).join(", ");
    add("group-sensitivity", `문항 하나를 빼면 개념 보충 그룹 소속이 바뀌는 학생: 최대 ${sens.max}명(${at} 제외 시)`, sens.max, n);
  }
  // 태그 없는 문항
  const untagged = m.items.filter((i) => (q[i.id] ?? []).length === 0).map((i) => `Q${i.number}`);
  if (untagged.length > 0) add("untagged", `태그 없는 문항 ${untagged.length}개(${untagged.join(", ")}): 개념 집계에서 빠짐`);

  // 확정 관계별 중복 현황 (관계가 맞는지 판단하는 근거가 아님)
  for (const r of relations) {
    const t = overlapTable(m, q, concepts, r.from, r.to, threshold);
    const shared = t.sharedItemIds.length > 0 ? `, ${t.sharedItemIds.map((id) => `Q${num.get(id)}`).join("·")}는 두 개념에 함께 태그됨` : "";
    const a = name.get(r.from);
    const b = name.get(r.to);
    add("overlap", `${a}–${b}(교수 확정 ${RELATION_LABEL[r.type]} 관계) 보충 대상 겹침: 둘 다 ${t.both}명, ${a}만 ${t.aOnly}명, ${b}만 ${t.bOnly}명, 둘 다 아님 ${t.neither}명(응시 ${t.n}명 중${shared})`, t.both, t.n);
  }

  // 저장된 교수 그룹안 (계산 그룹과 다른 사실)
  if (saved) {
    const mode = MODE_LABEL[saved.mode] ?? saved.mode;
    if (saved.status === "saved") {
      for (const g of saved.groups) add("saved-group", `교수가 저장한 보충 그룹안(${mode}${saved.settings.threshold !== undefined ? `, 기준 ${pct(saved.settings.threshold)}` : ""}) '${g.name}' ${g.studentIds.length}명`, g.studentIds.length, n);
    } else {
      add("saved-group", `교수가 보충 그룹화를 ${saved.status === "deferred" ? "보류" : "거부"}함${saved.reason ? `(사유: ${saved.reason})` : ""}`);
    }
  }
  return facts.map((f, i) => ({ ...f, id: factId(i) }));
}

export function factId(i: number): string {
  return `F${String(i + 1).padStart(2, "0")}`;
}
