// 서술형 결과 요약의 사실 목록 (docs/decisions.md §6.4, §8.4). 교수가 **확정한 점수만** 쓴다(§6.1 U2).
// 숫자가 든 문장은 모두 코드가 만든다. 학생 이름·답안 원문은 넣지 않는다(건수만).
import { charCount } from "../ai/validate";
import { factId, type Fact, type FactKind } from "../analysis/facts";
import { pct } from "../format";
import type { EssayQuizDataset } from "../types";
import { recordKey, type EssayGradesState } from "./grades";
import { aiVsFinal, confirmation, conceptScoreRates, levelDistribution } from "./metrics";

const LEVEL_LABEL = ["미흡(0)", "부분(1)", "충족(2)"] as const;

export function buildEssayFacts(ds: EssayQuizDataset, st: EssayGradesState): Fact[] {
  const facts: Omit<Fact, "id">[] = [];
  const add = (kind: FactKind, text: string, numerator: number | null = null, denominator: number | null = null) => facts.push({ kind, text, numerator, denominator });
  const done = () => facts.map((f, i) => ({ ...f, id: factId(i) }));

  const finished = ds.attempts.filter((a) => a.status === "finished").length;
  add("attempts", `응시 완료 ${finished}명(전체 ${ds.attempts.length}명 중, 미응시 ${ds.attempts.length - finished}명)`, finished, ds.attempts.length);

  const conf = confirmation(ds, st);
  add("essay-confirmation", `채점 확정 ${conf.numerator}건(채점 대상 ${conf.denominator}건 중 ${pct(conf.value)}), 확정한 답안만 분석에 씀`, conf.numerator, conf.denominator);

  // 제출 자체의 특징 (채점 전에도 알 수 있는 사실)
  const empty = ds.submissions.filter((s) => s.text === null || s.text.trim() === "").length;
  const over = ds.submissions.filter((s) => s.text && charCount(s.text) > (ds.quiz.items.find((i) => i.id === s.itemId)?.charLimit ?? Infinity)).length;
  if (empty + over > 0) add("essay-submission-flags", `무응답 제출 ${empty}건, 글자 수 제한 초과 ${over}건(제출 ${ds.submissions.length}건 중, 초과는 감점하지 않음)`, empty + over, ds.submissions.length);

  if (conf.numerator === 0) return done();

  const avf = aiVsFinal(ds, st);
  const { accepted, edited, manual } = avf.bySource;
  add("essay-final-source", `확정 출처: AI 제안 수락 ${accepted}건, 수정 후 확정 ${edited}건, 직접 채점 ${manual}건`, accepted + edited, conf.numerator);

  // 개념 점수율 (확정 기준 점수 합 / 최대점수 합)
  const name = new Map(ds.quiz.concepts.map((c) => [c.id, c.name]));
  const rates = conceptScoreRates(ds, st).filter((r) => r.criteria > 0 && r.rate.value !== null);
  for (const r of rates) add("essay-concept-rate", `${name.get(r.conceptId)} 개념 점수율 ${pct(r.rate.value)}(${r.rate.numerator}/${r.rate.denominator}점, 확정 답안 기준)`, r.rate.numerator, r.rate.denominator);
  if (rates.length >= 2) {
    for (const [label, pick] of [["가장 높은", Math.max], ["가장 낮은", Math.min]] as const) {
      const target = pick(...rates.map((r) => r.rate.value!));
      const tied = rates.filter((r) => Math.abs(r.rate.value! - target) < 1e-12);
      add("essay-concept-extreme", `확정 점수 기준 개념 점수율이 ${label} 개념${tied.length > 1 ? "(동률)" : ""}: ${tied.map((r) => `${name.get(r.conceptId)} ${pct(r.rate.value)}(${r.rate.numerator}/${r.rate.denominator}점)`).join(", ")}`);
    }
  }

  // 기준별 확정 수준 분포
  const dist = levelDistribution(ds, st);
  const rows: { label: string; zero: number; total: number }[] = [];
  for (const item of ds.quiz.items) {
    for (const c of item.rubric) {
      const d = dist[c.id]!;
      const total = d[0] + d[1] + d[2];
      if (total === 0) continue;
      const label = `${item.number}번 ${c.name}`;
      rows.push({ label, zero: d[0], total });
      add("essay-criterion-dist", `${label}: ${d.map((n, lv) => `${LEVEL_LABEL[lv]} ${n}건`).join(" · ")}(확정 ${total}건)`, d[2], total);
    }
  }
  // 비교 사실: 미흡(0) 비율이 가장 높은 기준 (비교는 이 사실로만 쓸 수 있다)
  if (rows.length >= 2) {
    const share = (r: (typeof rows)[number]) => r.zero / r.total;
    const top = Math.max(...rows.map(share));
    if (top > 0) {
      const tied = rows.filter((r) => Math.abs(share(r) - top) < 1e-12);
      add("essay-criterion-extreme", `미흡(0) 비율이 가장 높은 루브릭 기준${tied.length > 1 ? "(동률)" : ""}: ${tied.map((r) => `${r.label} ${pct(share(r))}(${r.zero}/${r.total}건)`).join(", ")}`);
    }
  }

  // AI 제안과 교수 확정의 일치 (제안을 본 뒤의 결정이라 독립 비교가 아님)
  if (avf.overall.pairs > 0) {
    add(
      "essay-ai-agreement",
      `AI 제안과 교수 확정의 기준 정확 일치 ${pct(avf.overall.exact.value)}(${avf.overall.exact.numerator}/${avf.overall.pairs}쌍, 제안을 본 뒤 결정한 값이라 독립 비교 아님)`,
      avf.overall.exact.numerator,
      avf.overall.pairs,
    );
  }
  return done();
}

/** 확정된 제출이 있는지 (요약 실행 조건) */
export function hasFinals(ds: EssayQuizDataset, st: EssayGradesState): boolean {
  return ds.submissions.some((s) => !!st.records[recordKey(s.attemptId, s.itemId)]?.final);
}
