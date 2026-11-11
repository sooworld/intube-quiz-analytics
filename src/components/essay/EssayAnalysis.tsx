"use client";
// 서술형 결과 분석 (docs/decisions.md §6.4). 확정 점수만 쓴다. 확정률을 항상 함께 보여 준다.
import Link from "next/link";
import { InfoTip } from "@/components/moodle/InfoTip";
import { providerModelLabel } from "@/lib/ai/capabilities";
import { aiVsFinal, aiVsReference, confirmation, conceptScoreRates, levelDistribution, type Agreement, type Ratio } from "@/lib/essay/metrics";
import { pct } from "@/lib/format";
import { useEssay } from "@/lib/state/EssayContext";
import { EssaySummaryCard } from "./EssaySummaryCard";

const fr = (r: Ratio) => `${r.numerator}/${r.denominator}`;

function AgreementRow({ label, a }: { label: string; a: Agreement }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="num">{a.pairs === 0 ? "자료 없음" : `${pct(a.exact.value)} (${fr(a.exact)})`}</td>
      <td className="num">{a.pairs === 0 ? "–" : `${pct(a.within1.value)} (${fr(a.within1)})`}</td>
      <td className="num">{a.mae === null ? "–" : a.mae.toFixed(2)}</td>
      <td className="num">{a.pairs === 0 ? "–" : `${a.over} / ${a.under}`}</td>
    </tr>
  );
}

function AgreementTable({ caption, rows }: { caption: string; rows: { label: string; a: Agreement }[] }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col" className="num">정확 일치</th>
            <th scope="col" className="num">±1 일치(보조)</th>
            <th scope="col" className="num">평균 절대 차이</th>
            <th scope="col" className="num">과대 / 과소 제안</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <AgreementRow key={r.label} label={r.label} a={r.a} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EssayAnalysis() {
  const { ds, grades, ready } = useEssay();
  if (!ready) return <p className="muted">채점 기록을 불러오는 중…</p>;

  const conf = confirmation(ds, grades);
  const avf = aiVsFinal(ds, grades);
  const avr = aiVsReference(ds, grades);
  const dist = levelDistribution(ds, grades);
  const rates = conceptScoreRates(ds, grades);
  const conceptName = new Map(ds.quiz.concepts.map((c) => [c.id, c.name]));
  const totalFinals = avf.bySource.accepted + avf.bySource.edited + avf.bySource.manual;

  return (
    <div className="stack">
      <dl className="grid-4">
        <div className="stat-tile">
          <dt className="label">확정률</dt>
          <dd className="value" style={{ margin: 0 }}>{pct(conf.value)}</dd>
          <dd className="detail" style={{ margin: 0 }}>확정 {fr(conf)} · 미확정 {conf.denominator - conf.numerator}건</dd>
        </div>
        <div className="stat-tile">
          <dt className="label">AI 제안 수락</dt>
          <dd className="value" style={{ margin: 0 }}>{avf.bySource.accepted}건</dd>
          <dd className="detail" style={{ margin: 0 }}>확정 {totalFinals}건 중</dd>
        </div>
        <div className="stat-tile">
          <dt className="label">수정 후 확정</dt>
          <dd className="value" style={{ margin: 0 }}>{avf.bySource.edited}건</dd>
        </div>
        <div className="stat-tile">
          <dt className="label">직접 채점</dt>
          <dd className="value" style={{ margin: 0 }}>{avf.bySource.manual}건</dd>
        </div>
      </dl>

      {conf.numerator === 0 ? (
        <div className="alert alert-info">
          <p>
            아직 확정한 답안이 없습니다. <Link href={`/essay/${ds.quiz.id}/grading/`}>채점 화면</Link>에서 확정하면 여기에 나타납니다.
          </p>
        </div>
      ) : null}

      <EssaySummaryCard />

      <section className="card" aria-labelledby="concept-title">
        <h2 className="card-title" id="concept-title">
          개념 점수율 (확정 점수 기준)
          <InfoTip label="개념 점수율">
            <span>확정 기준 점수 합 / 해당 개념 기준의 최대점수 합. 확정된 답안만 셉니다.</span>
            <span>서술형 점수율은 객관식 퀴즈의 관찰 오답률과 척도가 달라 직접 비교하지 않습니다.</span>
          </InfoTip>
        </h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th scope="col">개념</th><th scope="col" className="num">점수율</th><th scope="col" className="num">점수 / 최대</th><th scope="col" className="num">루브릭 기준 수</th></tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.conceptId}>
                  <th scope="row">{conceptName.get(r.conceptId)}</th>
                  <td className="num">{r.criteria === 0 ? "자료 없음" : pct(r.rate.value)}</td>
                  <td className="num">{r.criteria === 0 ? "–" : fr(r.rate)}</td>
                  <td className="num">{r.criteria}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="dist-title">
        <h2 className="card-title" id="dist-title">기준별 확정 수준 분포</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th scope="col">문항 · 기준</th><th scope="col" className="num">0 미흡</th><th scope="col" className="num">1 부분</th><th scope="col" className="num">2 충족</th><th scope="col" className="num">AI 제안과 정확 일치</th></tr>
            </thead>
            <tbody>
              {ds.quiz.items.flatMap((item) =>
                item.rubric.map((c) => {
                  const d = dist[c.id]!;
                  const a = avf.byCriterion[c.id];
                  return (
                    <tr key={c.id}>
                      <th scope="row">{item.number}번 · {c.name}</th>
                      {d.map((n, i) => (
                        <td key={i} className="num">{n}</td>
                      ))}
                      <td className="num">{a && a.pairs ? `${fr(a.exact)}` : "–"}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="avf-title">
        <h2 className="card-title" id="avf-title">
          AI 제안 vs 교수 확정
          <InfoTip label="AI 제안 vs 교수 확정">
            <span>비교 대상은 유효한 제안(검증 통과·검토 필요)에 연결된 확정입니다. 직접 채점은 빠집니다.</span>
            <span>교수는 제안을 본 뒤에 결정하므로 이 일치는 독립적인 채점 비교가 아닙니다. 0·1·2 척도에서 ±1 일치는 0↔2 차이만 불일치로 잡으므로 보조 지표로만 보세요.</span>
          </InfoTip>
        </h2>
        <p className="card-sub">
          확정 {avf.linkedFinals}건 · 기준 {avf.overall.pairs}쌍
        </p>
        <AgreementTable caption="AI 제안과 교수 확정의 일치" rows={[{ label: "전체 기준", a: avf.overall }]} />
      </section>

      <section className="card" aria-labelledby="avr-title">
        <h2 className="card-title" id="avr-title">
          AI 제안 vs 기준 채점 (데모 전용)
          <InfoTip label="AI 제안 vs 기준 채점">
            <span>가상 데이터를 만들 때 정한 기준 채점과 제공자·모델별 최신 유효 제안을 비교합니다. 제공자를 섞어 세지 않습니다.</span>
            <span>
              가상 데이터 기준 참고값입니다. 생성 답안은 의도한 수준을 문장으로 조합해 만들었으므로, 여기서 일치하는 것은 생성 규칙의 재현일 수 있으며 채점의 타당성을 검증하지 않습니다.
              보류 답안은 6편뿐이라 결론을 내리기에 너무 적습니다.
            </span>
          </InfoTip>
        </h2>
        {avr.length === 0 ? <p className="muted">아직 유효한 제안이 없습니다.</p> : null}
        {avr.map((g) => (
          <div key={`${g.provider}|${g.model}`} className="stack">
            <h3 className="small" style={{ margin: "0.5rem 0 0" }}>
              {g.provider === "mock" ? `Mock (규칙 기반, AI 아님) · ${g.model}` : providerModelLabel(g.provider, g.model)}{" "}
              <span className="muted">— 생성 답안 {g.submissions.generated}건, 보류 답안 {g.submissions.holdout}건</span>
            </h3>
            <AgreementTable
              caption={`${providerModelLabel(g.provider, g.model)} 제안과 기준 채점의 일치`}
              rows={[
                { label: "생성 답안 (문장 뱅크 조합)", a: g.generated },
                { label: "보류 답안 (손으로 작성)", a: g.holdout },
              ]}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
