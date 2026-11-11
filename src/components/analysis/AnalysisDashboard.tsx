"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConceptHeatmap, type HeatmapSelection } from "@/components/charts/ConceptHeatmap";
import { InfoTip } from "@/components/moodle/InfoTip";
import { XapiEvidence } from "@/components/xapi/XapiEvidence";
import { conceptTable } from "@/lib/analysis/concepts";
import { allItemStats, totalScore } from "@/lib/analysis/itemStats";
import { isWrong, itemsForConcept } from "@/lib/analysis/matrix";
import { pct } from "@/lib/format";
import { useQuiz } from "@/lib/state/QuizContext";
import { AnswerCell } from "./AnswerCell";
import { AttemptBanner } from "./AttemptBanner";
import { CoWrongTab } from "./CoWrongTab";
import { ItemAnalysisTab } from "./ItemAnalysisTab";
import { NetworkTab } from "./NetworkTab";
import { QMatrixNotice } from "./QMatrixNotice";
import { SummaryDraftCard } from "./SummaryDraftCard";

const TABS = [
  { id: "concepts", label: "개념별 약점" },
  { id: "items", label: "문제별 정답률" },
  { id: "cowrong", label: "같이 틀린 문제" },
  { id: "network", label: "문제 관계도" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function AnalysisDashboard() {
  const { ds, m, concepts, qmatrix, studentById, conceptById, itemById } = useQuiz();
  const [tab, setTab] = useState<TabId>("concepts");
  const [sel, setSel] = useState<HeatmapSelection | null>(null);
  const [sortBy, setSortBy] = useState<string>("id");

  // 탭은 URL 해시와 동기화한다 (#items 등으로 바로 진입 가능)
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace("#", "");
      if (TABS.some((t) => t.id === h)) setTab(h as TabId);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const selectTab = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };

  const table = useMemo(() => conceptTable(m, qmatrix, concepts), [m, qmatrix, concepts]);
  const stats = useMemo(() => allItemStats(m), [m]);

  const rowOrder = useMemo(() => {
    const ids = m.students.map((s) => s.id);
    if (sortBy === "id") return ids;
    const cells = new Map(table.rows.map((r) => [r.studentId, r.cells]));
    return [...ids].sort((a, b) => (cells.get(b)![sortBy]!.value ?? -1) - (cells.get(a)![sortBy]!.value ?? -1) || (a < b ? -1 : 1));
  }, [m, sortBy, table]);

  const worstConcept = useMemo(() => {
    const withData = concepts.filter((c) => table.classRow[c.id]!.value !== null);
    return withData.sort((a, b) => table.classRow[b.id]!.value! - table.classRow[a.id]!.value!)[0] ?? null;
  }, [concepts, table]);
  const hardestItem = useMemo(() => [...stats].sort((a, b) => (a.facility.value ?? 1) - (b.facility.value ?? 1))[0], [stats]);
  const meanScore = m.students.length ? m.students.reduce((s, st) => s + totalScore(m, st.id), 0) / m.students.length : null;

  return (
    <div>
      <div className="alert alert-info">
        <p>
          모든 수치는 <strong>실제로 틀린 비율</strong>이며, 개념을 익혔는지 판정하지는 않습니다.
          <InfoTip label="수치 해석">
            <span>10문항·25명 규모에서는 한 문항을 맞히고 틀리는 데 따라 값이 크게 움직일 수 있습니다.</span>
            <span>각 수치의 분모(몇 개 중 몇 개)와 근거 문항을 함께 확인하세요.</span>
          </InfoTip>
        </p>
      </div>
      <QMatrixNotice />
      <AttemptBanner />

      <dl className="grid-4" style={{ margin: "0 0 1.25rem" }}>
        <div className="stat-tile">
          <dt className="label">응시 완료</dt>
          <dd className="value" style={{ margin: 0 }}>{m.students.length}명</dd>
          <dd className="detail" style={{ margin: 0 }}>미응시 {m.notAttempted.length}명은 분석에서 제외</dd>
        </div>
        <div className="stat-tile">
          <dt className="label">평균 점수</dt>
          <dd className="value" style={{ margin: 0 }}>{meanScore === null ? "–" : meanScore.toFixed(1)} / {m.items.length}</dd>
        </div>
        <div className="stat-tile">
          <dt className="label">학급 오답률이 가장 높은 개념</dt>
          <dd className="value" style={{ margin: 0, fontSize: "var(--fs-lg)" }}>{worstConcept?.name ?? "–"}</dd>
          {worstConcept ? (
            <dd className="detail" style={{ margin: 0 }}>
              {pct(table.classRow[worstConcept.id]!.value)} ({table.classRow[worstConcept.id]!.numerator}/{table.classRow[worstConcept.id]!.denominator} 응답)
            </dd>
          ) : null}
        </div>
        <div className="stat-tile">
          <dt className="label">정답률이 가장 낮은 문항</dt>
          <dd className="value" style={{ margin: 0, fontSize: "var(--fs-lg)" }}>Q{itemById.get(hardestItem?.itemId ?? "")?.number ?? "–"}</dd>
          {hardestItem ? (
            <dd className="detail" style={{ margin: 0 }}>정답률 {pct(hardestItem.facility.value)} ({hardestItem.facility.numerator}/{hardestItem.facility.denominator}명)</dd>
          ) : null}
        </div>
      </dl>

      <SummaryDraftCard />

      <div className="tabs" role="tablist" aria-label="분석 보기">
        {TABS.map((t) => (
          <button key={t.id} id={`tab-${t.id}`} type="button" role="tab" className="tab-btn" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            onClick={() => selectTab(t.id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === t.id);
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
                selectTab(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-concepts" aria-labelledby="tab-concepts" hidden={tab !== "concepts"}>
        <div className="split">
          <section className="card" aria-labelledby="hm-title">
            <h2 className="card-title" id="hm-title">
              학생별 · 개념별 오답률
              <InfoTip label="개념별 오답률">
                <span>칸의 값 = 그 개념에 연결된 문항 중 틀린 비율입니다.</span>
                <span>학생 칸의 분수는 “틀린 문항 수/그 개념의 문항 수”입니다. 색이 같은 비율을 나타내고, 학급 전체 행에는 백분율도 적었습니다.</span>
                <span>한 문항이 여러 개념에 연결되어 있으면 그 문항의 오답은 연결된 모든 개념에 똑같이 들어갑니다. 그래서 개념별 오답률을 더해도 전체 오답률과 같지 않습니다.</span>
                <span>셀을 누르면 오른쪽에 근거 문항과 학생 답안이 나옵니다. 학급 전체 행을 고르면 그 개념의 문항별로 누가 틀렸는지 보여줍니다. 방향키로 셀을 이동하고 Enter로 근거를 엽니다.</span>
              </InfoTip>
            </h2>
            <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
              <label htmlFor="hm-sort" className="small">정렬</label>
              <select id="hm-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="id">학생 번호순</option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} 오답률 높은 순</option>
                ))}
              </select>
            </div>
            <ConceptHeatmap table={table} studentById={studentById} quizId={ds.quiz.id} selected={sel} onSelect={setSel} rowOrder={rowOrder} />
          </section>
          <section className="evidence" aria-live="polite" aria-labelledby="ev-title">
            {sel ? (
              renderEvidence(sel)
            ) : (
              <>
                <h3 id="ev-title">근거 보기</h3>
                <p className="muted">왼쪽 표에서 칸을 고르세요.</p>
              </>
            )}
          </section>
        </div>
        <div className="card" style={{ marginTop: "1rem" }}>
          <h2 className="card-title">
            다음 단계: 보충 그룹 검토
            <InfoTip label="보충 그룹 검토">
              <span>비슷한 개념에서 오답이 겹치는 학생이 있다면 보충 그룹을 검토할 수 있습니다. 근거가 부족하면 그룹을 만들지 않고 개별 분석을 유지하는 것도 정상적인 결정입니다.</span>
              <span>학생 이름을 누르면 개인 상세를 볼 수 있습니다.</span>
            </InfoTip>
          </h2>
          <div className="btn-row">
            <Link className="btn btn-primary" href={`/quiz/${ds.quiz.id}/groups/`}>보충 그룹 검토</Link>
          </div>
        </div>
      </div>

      <div role="tabpanel" id="panel-items" aria-labelledby="tab-items" hidden={tab !== "items"}>
        <ItemAnalysisTab stats={stats} />
      </div>

      <div role="tabpanel" id="panel-cowrong" aria-labelledby="tab-cowrong" hidden={tab !== "cowrong"}>
        <CoWrongTab />
      </div>

      <div role="tabpanel" id="panel-network" aria-labelledby="tab-network" hidden={tab !== "network"}>
        <NetworkTab />
      </div>
    </div>
  );

  function renderEvidence(sel: HeatmapSelection) {
    const concept = conceptById.get(sel.conceptId)!;
    const tagged = itemsForConcept(m, qmatrix, sel.conceptId);
    if (sel.rowId === "class") {
      const cm = table.classRow[sel.conceptId]!;
      return (
        <>
          <h3 id="ev-title">학급 전체 · {concept.name}</h3>
          <p className="small">
            오답률 <strong>{pct(cm.value)}</strong> — 연결 문항 {tagged.length}개 × 응시 {m.students.length}명 = {cm.denominator}개 응답 중 {cm.numerator}개 오답
          </p>
          {tagged.length === 0 ? (
            <p className="muted">이 개념에 연결된 문항이 없습니다.</p>
          ) : (
            <XapiEvidence
              key={`class:${sel.conceptId}`}
              label={`오답률 ${pct(cm.value)} (${cm.numerator}/${cm.denominator})`}
              itemIds={tagged}
              kind="wrong"
              numerator={cm.numerator}
              denominator={cm.denominator}
              unit="건"
            />
          )}
          <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
            {tagged.map((id) => {
              const it = itemById.get(id)!;
              const wrongStudents = m.students.filter((s) => isWrong(m, s.id, id));
              return (
                <li key={id}>
                  <strong>Q{it.number}</strong> {it.stem}
                  <div className="small muted">오답 {wrongStudents.length}/{m.students.length}명</div>
                  <div className="small">{wrongStudents.map((s) => s.name).join(", ") || "없음"}</div>
                </li>
              );
            })}
          </ul>
        </>
      );
    }
    const student = studentById.get(sel.rowId)!;
    const cell = table.rows.find((r) => r.studentId === sel.rowId)!.cells[sel.conceptId]!;
    return (
      <>
        <h3 id="ev-title">{student.name} · {concept.name}</h3>
        <p className="small">
          연결 문항 {cell.denominator}개 중 <strong>{cell.numerator}개 오답</strong> ({pct(cell.value)}) · 학급 {pct(table.classRow[sel.conceptId]!.value)}
        </p>
        {tagged.length === 0 ? (
          <p className="muted">이 개념에 연결된 문항이 없습니다.</p>
        ) : (
          <XapiEvidence
            key={`${sel.rowId}:${sel.conceptId}`}
            label={`오답률 ${pct(cell.value)} (${cell.numerator}/${cell.denominator})`}
            itemIds={tagged}
            studentIds={[sel.rowId]}
            kind="wrong"
            numerator={cell.numerator}
            denominator={cell.denominator}
            unit="문항"
          />
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th scope="col">문항</th><th scope="col">학생 답</th><th scope="col">채점</th></tr>
            </thead>
            <tbody>
              {tagged.map((id) => {
                const it = itemById.get(id)!;
                return (
                  <tr key={id}>
                    <th scope="row" style={{ fontWeight: 400 }}><strong>Q{it.number}</strong> {it.stem}</th>
                    <AnswerCell item={it} raw={m.raw[sel.rowId]![id] ?? null} state={m.state[sel.rowId]![id]!} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: "0.75rem" }}>
          <Link href={`/quiz/${ds.quiz.id}/student/${sel.rowId}/`}>{student.name} 학생 상세 보기 →</Link>
        </p>
      </>
    );
  }
}
