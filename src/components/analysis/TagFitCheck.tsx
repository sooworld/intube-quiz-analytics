"use client";

import { useMemo, useState } from "react";
import { InfoTip } from "@/components/moodle/InfoTip";
import { hashQMatrix } from "@/lib/analysis/matrix";
import {
  conceptContrast,
  looContrast,
  pairTable,
  phiMatrix,
  sharedTags,
  tagContrast,
  type GroupMean,
} from "@/lib/analysis/tagFit";
import { useQuiz } from "@/lib/state/QuizContext";
import type { Item, QMatrix } from "@/lib/types";

/** 소수 둘째 자리. 음수는 유니코드 마이너스로 표기한다. null이면 "계산 불가" */
function r2(v: number | null): string {
  if (v === null) return "계산 불가";
  const s = (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
}

function GroupValue({ g }: { g: GroupMean }) {
  return (
    <>
      {g.total === 0 ? "해당 쌍 없음" : g.valid === 0 ? "자료 없음" : r2(g.mean)}{" "}
      <span className="small muted">(유효 {g.valid}/{g.total}쌍)</span>
    </>
  );
}

/**
 * 탐색: 공유 태그가 있는 문항끼리 더 함께 움직이는가 (D7).
 * phi와 2×2는 응답만으로 계산하고, 묶음 값만 편집 중 태그(draft)를 따른다.
 */
export function TagFitCheck({ draft }: { draft: QMatrix }) {
  const { m, concepts, conceptById, defaultQ } = useQuiz();
  const phi = useMemo(() => phiMatrix(m), [m]);
  const contrast = useMemo(() => tagContrast(phi, m.items, draft), [phi, m, draft]);
  const loo = useMemo(() => looContrast(m, draft), [m, draft]);
  const byConcept = useMemo(() => conceptContrast(phi, m.items, draft, concepts), [phi, m, draft, concepts]);
  const isDefault = useMemo(() => hashQMatrix(draft) === hashQMatrix(defaultQ), [draft, defaultQ]);
  const baseline = useMemo(() => tagContrast(phi, m.items, defaultQ), [phi, m, defaultQ]);

  const [baseId, setBaseId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);

  const n = m.students.length;
  const idx = (id: string) => m.items.findIndex((i) => i.id === id);
  const tagNames = (id: string) => (draft[id] ?? []).map((c) => conceptById.get(c)?.name ?? c);
  const correctCount = (id: string) => m.students.filter((s) => m.state[s.id]![id] === "correct").length;
  const unansweredCount = (id: string) => m.students.filter((s) => m.state[s.id]![id] === "unanswered").length;

  const base = baseId ? m.items.find((i) => i.id === baseId) ?? null : null;
  const compare = base && compareId && compareId !== base.id ? m.items.find((i) => i.id === compareId) ?? null : null;

  const choose = (id: string) => {
    setBaseId(id);
    if (!compareId || compareId === id) setCompareId(m.items.find((i) => i.id !== id)?.id ?? null);
  };

  return (
    <details className="card tagfit">
      <summary>
        <h2 className="card-title" id="tf-title" style={{ display: "inline" }}>
          점검: 같은 개념 문항끼리 맞고 틀린 양상이 더 비슷한가
        </h2>
        <div className="small muted" style={{ marginTop: "0.25rem" }}>편집 중 초안 기준 · 판정하지 않는 참고값입니다. 펼쳐서 보기</div>
      </summary>

      <div className="stack" style={{ marginTop: "1rem" }}>
        <p className="card-sub" style={{ margin: 0 }}>
          문항 쌍마다 맞고 틀린 양상이 얼마나 비슷한지(−1~1) 구해, <strong>공통 개념이 있는 쌍</strong>과 <strong>없는 쌍</strong>의 평균을 비교합니다. 응시 완료 {n}명 기준.
          <InfoTip label="비슷함 지표">
            <span>이 비슷함은 phi 계수입니다. 1이면 두 문항을 같은 학생들이 맞히고 틀렸고, 0이면 관계가 없습니다.</span>
            <span>이 인원에서는 문항 쌍 하나의 값이 크게 흔들려, 쌍마다 판정하지 않고 묶음 평균만 요약합니다.</span>
            <span>정답률·전반 실력·문항 형식을 조정하지 않았고, 쌍마다 같은 무게로 평균하므로 개념들을 동등하게 평가한 값도 아닙니다.</span>
            <span>함께 움직인다고 같은 개념을 측정한다는 뜻도, 한 문항이 다른 문항에 영향을 준다는 뜻도 아닙니다.</span>
          </InfoTip>
        </p>

        <dl className="grid-4" style={{ margin: 0 }}>
          <div className="stat-tile">
            <dt className="label">공통 개념 있는 쌍 평균</dt>
            <dd className="value" style={{ margin: 0 }}><GroupValue g={contrast.shared} /></dd>
          </div>
          <div className="stat-tile">
            <dt className="label">공통 개념 없는 쌍 평균</dt>
            <dd className="value" style={{ margin: 0 }}><GroupValue g={contrast.other} /></dd>
          </div>
          <div className="stat-tile">
            <dt className="label">차이 (있음 − 없음)</dt>
            <dd className="value" style={{ margin: 0 }}>{r2(contrast.diff)}</dd>
            {contrast.diff === null ? <dd className="detail" style={{ margin: 0 }}>한쪽 묶음에 계산 가능한 쌍이 없습니다</dd> : null}
          </div>
          <div className="stat-tile">
            <dt className="label">학생 1명을 뺐을 때 차이의 범위</dt>
            <dd className="value" style={{ margin: 0, fontSize: "var(--fs-lg)" }}>
              {loo.min === null ? "계산 불가" : `${r2(loo.min)} ~ ${r2(loo.max)}`}
            </dd>
            <dd className="detail" style={{ margin: 0 }}>{loo.total}회 중 {loo.valid}회 유효</dd>
          </div>
        </dl>
        {!isDefault ? (
          <p className="small" style={{ margin: 0 }}>
            기본 설정 기준 참고값: 있음 {r2(baseline.shared.mean)} · 없음 {r2(baseline.other.mean)} · 차이 {r2(baseline.diff)}
          </p>
        ) : null}
        {contrast.untaggedPairs > 0 ? (
          <p className="small muted" style={{ margin: 0 }}>개념이 없는 문항이 낀 {contrast.untaggedPairs}쌍은 어느 묶음에도 넣지 않았습니다.</p>
        ) : null}

        <p className="caveat">이 값을 키우려고 개념을 고치는 것은 목표가 아닙니다. 문제별 개념은 문항 내용을 보고 정하세요.</p>

        <details>
          <summary className="small">개념별 상세 (개념마다 쌍이 몇 개뿐이라 전체 요약보다 더 흔들립니다)</summary>
          <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
            <table className="data">
              <caption className="visually-hidden">개념별 문항 쌍 phi 평균</caption>
              <thead>
                <tr>
                  <th scope="col">개념</th>
                  <th scope="col" className="num">태그 문항 수</th>
                  <th scope="col" className="num">개념 내부 쌍 평균</th>
                  <th scope="col" className="num">공유 태그 없는 문항과의 평균</th>
                </tr>
              </thead>
              <tbody>
                {byConcept.map((r) => (
                  <tr key={r.conceptId}>
                    <th scope="row">{conceptById.get(r.conceptId)?.name ?? r.conceptId}</th>
                    <td className="num">{r.itemCount}</td>
                    <td className="num"><GroupValue g={r.within} /></td>
                    <td className="num"><GroupValue g={r.outside} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <div className="split">
          <section aria-labelledby="tf-items">
            <h3 id="tf-items" style={{ fontSize: "var(--fs-lg)" }}>문항 내용 검토</h3>
            <p className="small muted">문항 번호순입니다. 문항별 점수나 순위는 두지 않았습니다. 비교할 문항을 골라 두 문항의 내용과 응답 빈도를 함께 보세요.</p>
            <div className="table-wrap">
              <table className="data">
                <caption className="visually-hidden">문항별 태그와 정답률</caption>
                <thead>
                  <tr>
                    <th scope="col">문항</th>
                    <th scope="col">편집 중 태그</th>
                    <th scope="col" className="num">정답</th>
                    <th scope="col" className="num">무응답</th>
                    <th scope="col"><span className="visually-hidden">비교</span></th>
                  </tr>
                </thead>
                <tbody>
                  {m.items.map((it) => (
                    <tr key={it.id} className={baseId === it.id ? "is-selected" : undefined}>
                      <th scope="row" style={{ fontWeight: 400 }}>
                        <strong>Q{it.number}</strong> <span className="small">{it.stem}</span>
                      </th>
                      <td className="small">{tagNames(it.id).join(", ") || <span className="muted">태그 없음</span>}</td>
                      <td className="num">{correctCount(it.id)}/{n}</td>
                      <td className="num">{unansweredCount(it.id)}</td>
                      <td>
                        <button type="button" className="btn btn-outline btn-sm" aria-pressed={baseId === it.id} onClick={() => choose(it.id)}>
                          Q{it.number} 기준으로 비교
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="evidence" aria-live="polite" aria-labelledby="tf-evidence">
            {base ? (
              <>
                <h3 id="tf-evidence">Q{base.number}와 비교</h3>
                <label htmlFor="tf-compare" className="small">비교할 문항</label>{" "}
                <select id="tf-compare" value={compare?.id ?? ""} onChange={(e) => setCompareId(e.target.value)}>
                  {m.items
                    .filter((i) => i.id !== base.id)
                    .map((i) => {
                      const sh = sharedTags(base.id, i.id, draft).map((c) => conceptById.get(c)?.name ?? c);
                      return (
                        <option key={i.id} value={i.id}>
                          Q{i.number} — 공유 태그 {sh.length ? sh.join(", ") : "없음"}
                        </option>
                      );
                    })}
                </select>
                {compare ? renderPair(base, compare) : null}
              </>
            ) : (
              <>
                <h3 id="tf-evidence">두 문항 비교</h3>
                <p className="muted">왼쪽 표에서 기준 문항을 고르면, 비교할 문항과의 응답 빈도와 두 문항의 내용을 보여줍니다.</p>
              </>
            )}
          </section>
        </div>

        <details>
          <summary className="small">실제 수업 자료에서 두 문항이 함께 움직이게 만드는 다른 이유</summary>
          <ul className="small" style={{ paddingLeft: "1.25rem" }}>
            <li>문항 위치·피로·시간 부족 (뒤쪽 문항을 함께 놓치는 경우)</li>
            <li>공통 지문, 앞 문항에 들어 있는 힌트</li>
            <li>정답 위치 선호와 찍기 (예: 여러 문항의 정답이 같은 기호)</li>
            <li>단답형 채점 정책 (허용 답안 범위)</li>
            <li>함께 비워 둔 무응답</li>
          </ul>
          <p className="small muted">이 데모의 가상 데이터에는 위 효과를 넣지 않았습니다.</p>
        </details>
      </div>
    </details>
  );

  function renderPair(a: Item, b: Item) {
    const t = pairTable(m, a.id, b.id);
    const v = phi[idx(a.id)]![idx(b.id)] ?? null;
    const sh = sharedTags(a.id, b.id, draft).map((c) => conceptById.get(c)?.name ?? c);
    return (
      <div className="stack" style={{ marginTop: "0.75rem" }}>
        <p className="small" style={{ margin: 0 }}>
          함께 맞고 틀리는 정도(phi) <strong>{r2(v)}</strong> · 공유 태그 {sh.length ? sh.join(", ") : "없음"}
        </p>
        <div className="table-wrap">
          <table className="data">
            <caption className="small" style={{ textAlign: "left", captionSide: "top" }}>
              관찰 빈도 (조정 전, 오답에 무응답 포함, {t.n}명)
            </caption>
            <thead>
              <tr>
                <th scope="col"><span className="visually-hidden">행 Q{a.number}, 열 Q{b.number}</span></th>
                <th scope="col" className="num">Q{b.number} 정답</th>
                <th scope="col" className="num">Q{b.number} 오답</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Q{a.number} 정답</th>
                <td className="num">{t.bothCorrect}명</td>
                <td className="num">{t.aOnly}명</td>
              </tr>
              <tr>
                <th scope="row">Q{a.number} 오답</th>
                <td className="num">{t.bOnly}명</td>
                <td className="num">{t.bothWrong}명</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: 0 }}>두 문항 모두 무응답: {t.bothUnanswered}명</p>
        {renderItem(a)}
        {renderItem(b)}
      </div>
    );
  }

  function renderItem(item: Item) {
    return (
      <div className="small">
        <strong>Q{item.number}</strong> {item.stem}
        <div className="muted">태그: {tagNames(item.id).join(", ") || "없음"}</div>
        {item.type === "mcq" ? (
          <ul style={{ paddingLeft: "1.25rem", margin: "0.25rem 0" }}>
            {(item.options ?? []).map((o) => (
              <li key={o.id}>
                <span className="answer-chip">{o.id}</span> {o.text}
                {o.id === item.correctOptionId ? <strong> (정답)</strong> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div>
            허용 답안: {(item.shortAnswer?.accepted ?? []).join(", ")}
            {item.shortAnswer?.policy === "numeric" && item.shortAnswer.tolerance !== undefined ? ` (허용 오차 ±${item.shortAnswer.tolerance})` : ""}
          </div>
        )}
      </div>
    );
  }
}
