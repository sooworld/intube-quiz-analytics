"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { InfoTip } from "@/components/moodle/InfoTip";
import { studentConcept } from "@/lib/analysis/concepts";
import {
  bundleGroup,
  bundleSensitivity,
  bundlesFromRelations,
  clusterSensitivity,
  conceptGroupSensitivity,
  conceptGroups,
  densitySensitivity,
  EXPLORE_LABEL,
  exploreClusters,
  exploreDensity,
  type Sensitivity,
} from "@/lib/analysis/groups";
import { RELATION_LABEL } from "@/lib/analysis/relations";
import { relationSnapshot } from "@/lib/state/aiRecords";
import { itemsForConcept } from "@/lib/analysis/matrix";
import { formatDateTime, pct } from "@/lib/format";
import { useQuiz, type GroupDecision, type SavedGroup } from "@/lib/state/QuizContext";

type Mode = "concept" | "bundle" | "cluster" | "density";

/** 묶음 카드 색 (구분용일 뿐 순서·수준을 뜻하지 않는다) */
const GROUP_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];

/** 같은 무리로 볼 기준: 두 학생의 틀린 문항 겹침(Jaccard) ≥ 1 − eps. 거리 반경 eps를 겹침 비율로 보여 준다 */
const EPS_OPTIONS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
const overlapText = (eps: number) => `틀린 문항이 ${Math.round((1 - eps) * 100)}% 이상 겹침`;

const THRESHOLDS = [
  { value: 0.01, label: "그 개념 문항을 1개 이상 틀림" },
  { value: 0.5, label: "그 개념 문항의 절반 이상 틀림 (기본)" },
  { value: 1, label: "그 개념 문항을 모두 틀림" },
];

const STATUS_LABEL: Record<GroupDecision["status"], string> = { saved: "그룹안 저장됨", deferred: "그룹화 보류", rejected: "제안 거부" };

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

export function GroupProposal() {
  const { dReady } = useQuiz();
  if (!dReady) return <p className="muted">저장된 결정을 불러오는 중…</p>;
  return <Proposal />;
}

function Proposal() {
  const q = useQuiz();
  const { m, concepts, qmatrix, qmatrixHash, studentById, conceptById, itemById, ds, decision, decisionStale, saveDecision, clearDecision, dStatus, relations } = q;
  const [mode, setMode] = useState<Mode>("concept");
  const [threshold, setThreshold] = useState(0.5);
  const [k, setK] = useState(3);
  const [eps, setEps] = useState(0.4);
  const [minPts, setMinPts] = useState(3);
  const [edits, setEdits] = useState<SavedGroup[] | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  /** 묶음에 쓸 확정 관계 id */
  const [relIds, setRelIds] = useState<string[]>([]);

  const conceptAlgo = useMemo<SavedGroup[]>(
    () =>
      conceptGroups(m, qmatrix, concepts, threshold).map((g) => ({
        name: `${conceptById.get(g.conceptId)?.name ?? g.conceptId} 보충`,
        studentIds: g.members.map((x) => x.studentId),
        source: "algorithm",
        conceptId: g.conceptId,
      })),
    [m, qmatrix, concepts, threshold, conceptById],
  );
  // 개념 묶음 (docs/decisions.md §8.5): 선택한 확정 관계로 이어진 개념들 → 각 개념 보충 그룹의 합집합
  const selectedRels = useMemo(() => relations.filter((r) => relIds.includes(r.id)), [relations, relIds]);
  const bundles = useMemo(() => bundlesFromRelations(concepts, selectedRels), [concepts, selectedRels]);
  const bundleResults = useMemo(() => bundles.map((ids) => bundleGroup(m, qmatrix, concepts, ids, threshold)), [bundles, m, qmatrix, concepts, threshold]);
  const bundleAlgo = useMemo<SavedGroup[]>(
    () =>
      bundleResults.map((b) => ({
        name: `${b.conceptIds.map((c) => conceptById.get(c)?.name ?? c).join("·")} 묶음 보충`,
        studentIds: b.members.map((x) => x.studentId),
        source: "algorithm",
        bundle: {
          conceptIds: b.conceptIds,
          rule: "union",
          threshold,
          relations: selectedRels.filter((r) => b.conceptIds.includes(r.from)).map(relationSnapshot),
        },
      })),
    [bundleResults, conceptById, threshold, selectedRels],
  );
  const exploration = useMemo(() => exploreClusters(m, qmatrix, concepts, k), [m, qmatrix, concepts, k]);
  const clusterAlgo = useMemo<SavedGroup[]>(
    () => exploration.clusters.map((c) => ({ name: `묶음 ${c.label + 1}`, studentIds: c.studentIds, source: "algorithm" })),
    [exploration],
  );
  const density = useMemo(() => exploreDensity(m, qmatrix, concepts, eps, minPts), [m, qmatrix, concepts, eps, minPts]);
  const densityAlgo = useMemo<SavedGroup[]>(
    () => density.clusters.map((c) => ({ name: `무리 ${c.label + 1}`, studentIds: c.studentIds, source: "algorithm" })),
    [density],
  );
  const sensitivity: Sensitivity = useMemo(
    () =>
      mode === "concept"
        ? conceptGroupSensitivity(m, qmatrix, concepts, threshold)
        : mode === "bundle"
          ? bundleSensitivity(m, qmatrix, concepts, bundles, threshold)
          : mode === "cluster"
          ? clusterSensitivity(m, k)
          : densitySensitivity(m, eps, minPts),
    [mode, m, qmatrix, concepts, threshold, k, eps, minPts, bundles],
  );

  const algo = mode === "concept" ? conceptAlgo : mode === "bundle" ? bundleAlgo : mode === "cluster" ? clusterAlgo : densityAlgo;
  const settings = mode === "concept" || mode === "bundle" ? { threshold } : mode === "cluster" ? { k } : { eps, minPts };
  /** 겹침 소속을 허용하는 모드 (학생 추가·빼기) */
  const overlapping = mode === "concept" || mode === "bundle";
  const groups = edits ?? algo;
  const edited = edits !== null && edits.some((g, i) => !sameMembers(g.studentIds, algo[i]?.studentIds ?? []));
  const name = (sid: string) => studentById.get(sid)?.name ?? sid;

  const resetEdits = () => setEdits(null);
  const changeMode = (next: Mode) => { setMode(next); resetEdits(); setMessage(null); };

  const removeMember = (gi: number, sid: string) =>
    setEdits(groups.map((g, i) => (i === gi ? { ...g, studentIds: g.studentIds.filter((s) => s !== sid) } : g)));
  const addMember = (gi: number, sid: string) =>
    setEdits(groups.map((g, i) => (i === gi && !g.studentIds.includes(sid) ? { ...g, studentIds: [...g.studentIds, sid].sort() } : g)));
  /** 계층 군집은 상호배타: 한 그룹에서 빼서 다른 그룹으로 옮긴다 (-1 = 제외) */
  const moveMember = (from: number, sid: string, to: number) =>
    setEdits(
      groups.map((g, i) => {
        if (i === from) return { ...g, studentIds: g.studentIds.filter((s) => s !== sid) };
        if (i === to) return { ...g, studentIds: [...g.studentIds, sid].sort() };
        return g;
      }),
    );

  const base = { dataVersion: ds.dataVersion, qmatrixHash, savedAt: new Date().toISOString() };
  const save = () => {
    const kept = groups
      .filter((g) => g.studentIds.length > 0)
      .map((g) => {
        const orig = algo.find((a) => a.name === g.name);
        return { ...g, source: orig && sameMembers(orig.studentIds, g.studentIds) ? "algorithm" : "edited" } as SavedGroup;
      });
    saveDecision({ ...base, status: "saved", mode, settings, groups: kept });
    setMessage("이 브라우저에 그룹안을 저장했습니다. 실제 수업 그룹은 만들어지지 않습니다.");
  };
  const defer = () => {
    saveDecision({ ...base, status: "deferred", mode: "none", settings: {}, reason: reason.trim() || undefined, groups: [] });
    setMessage("그룹화를 보류하고 개별 분석을 유지하기로 저장했습니다.");
  };
  const reject = () => {
    saveDecision({ ...base, status: "rejected", mode, settings, reason: reason.trim() || undefined, groups: [] });
    setMessage("이번 제안을 거부했다고 저장했습니다.");
  };

  return (
    <div className="stack">
      <div className="alert alert-warning">
        <p>
          그룹은 <strong>검토 제안</strong>입니다. 한 번의 10문항 퀴즈로 학생을 고정된 집단으로 나누면 부정확한 낙인이 생길 수 있습니다. 근거가 부족하면
          그룹을 만들지 않고 개별 분석을 유지하는 것도 정상적인 결정입니다.
        </p>
      </div>
      {dStatus === "discarded" ? <div className="alert alert-warning" role="status"><p>저장된 그룹안이 손상되었거나 이전 데이터 버전이라 버렸습니다.</p></div> : null}
      {dStatus === "session-only" ? <div className="alert alert-warning" role="status"><p>브라우저 저장소를 쓸 수 없어, 결정은 이번 세션에만 반영됩니다.</p></div> : null}

      {decision ? (
        <section className="card" aria-labelledby="saved-title">
          <div className="btn-row" style={{ justifyContent: "space-between" }}>
            <h2 className="card-title" id="saved-title">
              저장된 결정: {STATUS_LABEL[decision.status]} {decisionStale ? <span className="badge badge-danger">재검토 필요</span> : <span className="badge badge-ok">현재 문제별 개념과 일치</span>}
            </h2>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { clearDecision(); setMessage("저장된 결정을 삭제했습니다."); }}>저장된 결정 삭제</button>
          </div>
          <p className="small muted">
            {formatDateTime(decision.savedAt)} 저장 · 이 브라우저에만 보관됨
            {decision.mode !== "none" ? ` · 방식: ${decision.mode === "concept" ? `개념별 보충 그룹 (기준 ${pct(decision.settings.threshold ?? null)})` : decision.mode === "bundle" ? `개념 묶음 보충 그룹 (합집합, 기준 ${pct(decision.settings.threshold ?? null)})` : decision.mode === "cluster" ? `${EXPLORE_LABEL.cluster} (${decision.settings.k}묶음)` : `${EXPLORE_LABEL.density} (${overlapText(decision.settings.eps ?? 0)}, 최소 ${decision.settings.minPts}명)`}` : ""}
          </p>
          {decisionStale ? (
            <p className="small" style={{ color: "var(--danger-text)" }}>
              저장 이후 문제별 개념{decision.mode === "bundle" ? "나 묶음에 쓴 개념 관계" : ""}가 바뀌어, 이 결정의 근거가 현재 분석과 다를 수 있습니다. 아래에서 다시 검토하고 저장하세요.
            </p>
          ) : null}
          {decision.reason ? <p className="small">사유: {decision.reason}</p> : null}
          {decision.groups.length ? (
            <ul className="small" style={{ paddingLeft: "1.25rem" }}>
              {decision.groups.map((g) => (
                <li key={g.name}>
                  <strong>{g.name}</strong> {g.source === "edited" ? <span className="badge badge-info">교수 수정</span> : <span className="badge">제안 그대로</span>} — {g.studentIds.map(name).join(", ")}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="card" aria-labelledby="gp-title">
        <h2 className="card-title" id="gp-title">
          그룹 제안
          <InfoTip label="그룹 제안">
            <span>
              {mode === "concept"
                ? "학생 이름 옆 분수는 그 개념의 문항 중 틀린 수입니다. 기준을 바꾸면 수정 내용은 초기화됩니다."
                : mode === "bundle"
                  ? "분수는 개념별 문항 중 틀린 수입니다. 한 문항이 두 개념에 함께 연결되어 있으면 그 응답이 두 개념 모두에 반영됩니다. 묶음은 개인 처방이 아니라 함께 다시 볼 학생 목록이며, 관계·기준을 바꾸면 수정 내용은 초기화됩니다."
                : mode === "density"
                  ? "겹침 기준과 최소 인원은 교수가 고르며, 자동으로 최적값을 정하지 않습니다. 모두 맞힌 학생은 틀린 문항이 없어 오답이 있는 학생과 겹치지 않습니다. 무리 번호와 색은 구분용일 뿐 순서나 수준을 뜻하지 않습니다."
                  : "묶음 수는 교수가 고릅니다. 자동 지표로 정하지 않습니다. 묶음 번호와 색은 구분용일 뿐 순서나 수준을 뜻하지 않습니다."}
            </span>
            {mode === "cluster" ? <span>계산 방법: 학생별 틀린 문항 집합의 Jaccard 거리로 평균 연결 계층 군집을 만든 뒤 고른 묶음 수로 잘랐습니다.</span> : null}
            {mode === "density" ? <span>계산 방법: 학생별 틀린 문항 집합의 Jaccard 거리로 DBSCAN을 돌렸습니다(최소 인원은 자기 포함, 겹침 기준 = 1 − 반경 eps).</span> : null}
          </InfoTip>
        </h2>
        <div className="btn-row" style={{ marginBottom: "0.75rem" }}>
          <span className="chip-toggle" role="group" aria-label="그룹 방식">
            <button type="button" aria-pressed={mode === "concept"} onClick={() => changeMode("concept")}>개념별 보충 그룹 (기본)</button>
            <button type="button" aria-pressed={mode === "bundle"} onClick={() => changeMode("bundle")}>개념 묶음 (확정 관계)</button>
            <button type="button" aria-pressed={mode === "cluster"} onClick={() => changeMode("cluster")}>{EXPLORE_LABEL.cluster} (참고)</button>
            <button type="button" aria-pressed={mode === "density"} onClick={() => changeMode("density")}>{EXPLORE_LABEL.density} (참고)</button>
          </span>
          {overlapping ? (
            <>
              <label htmlFor="gp-th" className="small">기준</label>
              <select id="gp-th" value={threshold} onChange={(e) => { setThreshold(Number(e.target.value)); resetEdits(); }}>
                {THRESHOLDS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </>
          ) : mode === "density" ? (
            <>
              <label htmlFor="gp-eps" className="small">같은 무리 기준</label>
              <select id="gp-eps" value={eps} onChange={(e) => { setEps(Number(e.target.value)); resetEdits(); }}>
                {EPS_OPTIONS.map((v) => <option key={v} value={v}>{overlapText(v)}</option>)}
              </select>
              <label htmlFor="gp-minpts" className="small">무리 최소 인원</label>
              <select id="gp-minpts" value={minPts} onChange={(e) => { setMinPts(Number(e.target.value)); resetEdits(); }}>
                {[2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}명</option>)}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="gp-k" className="small">묶음 수</label>
              <select id="gp-k" value={k} onChange={(e) => { setK(Number(e.target.value)); resetEdits(); }}>
                {[2, 3, 4, 5, 6].map((v) => <option key={v} value={v}>{v}개</option>)}
              </select>
            </>
          )}
          {edited ? (
            <>
              <span className="badge badge-info">교수 수정본</span>
              <button type="button" className="btn btn-link btn-sm" onClick={resetEdits}>제안으로 되돌리기</button>
            </>
          ) : null}
        </div>

        {mode === "bundle" ? (
          <div className="small" style={{ marginBottom: "0.75rem" }}>
            <p className="muted">
              교수가 확정한 개념 관계로 이어진 개념들을 한 묶음으로 보고, 그 개념 중 <strong>하나 이상에서 기준 이상</strong> 틀린 학생을 모읍니다(각 개념 보충 그룹의 합집합). 새 오답률을 만들지 않으며, 학생마다 어느 개념 기준에 들었는지 함께 보여 줍니다. 관계는 내용에 대한 교수의 판단이고 응답 데이터로 검증한 것이 아닙니다.
            </p>
            {relations.length === 0 ? (
              <p>
                확정한 개념 관계가 없습니다. <Link href={`/quiz/${ds.quiz.id}/qmatrix/`}>문제별 개념 화면</Link>에서 관계를 확정하세요.
              </p>
            ) : (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="small">
                  <strong>묶음에 쓸 관계</strong> (같은 개념을 공유하는 관계는 한 묶음이 됩니다)
                </legend>
                {relations.map((r) => (
                  <label key={r.id} style={{ display: "inline-flex", gap: 4, marginRight: 12 }}>
                    <input
                      type="checkbox"
                      checked={relIds.includes(r.id)}
                      onChange={(e) => {
                        setRelIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)));
                        resetEdits();
                      }}
                    />
                    {conceptById.get(r.from)?.name} {r.type === "prerequisite" ? "→" : "—"} {conceptById.get(r.to)?.name} ({RELATION_LABEL[r.type]})
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        ) : mode === "concept" ? (
          <p className="small muted">
            개념마다 기준 이상 틀린 학생을 모읍니다. 한 학생이 여러 그룹에 들 수 있습니다. 각 그룹의 근거는 그 개념에 연결된 문항입니다.
          </p>
        ) : mode === "density" ? (
          <p className="small muted">
            틀린 문항이 기준 이상 겹치는 학생이 최소 인원 이상 모인 곳을 무리로 찾습니다. 어느 무리에도 들지 않은 학생은 <strong>현재 조건에서 그룹 미배정</strong>으로
            남습니다. 미배정은 학업상 문제가 있다는 뜻이 아닙니다.
          </p>
        ) : (
          <p className="small muted">
            틀린 문항이 많이 겹치는 학생끼리 차례로 묶어 고른 묶음 수만큼 나눕니다. 참고용 분할이며 실제로 이런 집단이 있다는 근거는 아닙니다. 한 학생은 한 묶음에만
            들어갑니다.
          </p>
        )}

        <div className="small" style={{ marginBottom: "0.75rem" }}>
          <strong>민감도:</strong>{" "}
          {mode === "cluster" ? (
            <>문항 하나를 빼고 다시 묶으면 최대 <strong>{sensitivity.max}명</strong>이 다른 묶음으로 옮겨 갑니다</>
          ) : mode === "density" ? (
            <>문항 하나를 빼고 다시 찾으면 최대 <strong>{sensitivity.max}명</strong>이 다른 무리로 옮기거나 미배정 여부가 바뀝니다</>
          ) : (
            <>문항 하나를 빼고 다시 계산하면 최대 <strong>{sensitivity.max}명</strong>의 그룹 소속이 바뀝니다</>
          )}{" "}
          (응시 {m.students.length}명).{" "}
          <details style={{ display: "inline" }}>
            <summary className="small" style={{ display: "inline", cursor: "pointer", color: "var(--primary)" }}>문항별 보기</summary>
            <span className="small"> {sensitivity.perItem.map((p) => `Q${itemById.get(p.itemId)?.number} 제외 시 ${p.changed}명`).join(" · ")}</span>
          </details>
        </div>

        {mode === "density" ? (
          <p className="small">
            <strong>결과:</strong> 무리 {density.clusters.length}개 · 그룹 미배정 {density.unassigned.length}명
            {density.unassigned.length ? <span className="muted"> ({density.unassigned.map(name).join(", ")})</span> : null}
          </p>
        ) : null}

        <div className="grid-2" style={{ marginTop: "1rem" }}>
          {groups.map((g, gi) => {
            const nonMembers = m.students.filter((s) => !g.studentIds.includes(s.id));
            const cluster = mode === "cluster" ? exploration.clusters[gi] : mode === "density" ? density.clusters[gi] : undefined;
            const tagged = g.conceptId ? itemsForConcept(m, qmatrix, g.conceptId) : [];
            const repConcept = cluster
              ? concepts
                  .filter((c) => (cluster.conceptMeans[c.id] ?? 0) >= 0.5)
                  .sort((a, b) => (cluster.conceptMeans[b.id] ?? 0) - (cluster.conceptMeans[a.id] ?? 0))
              : [];
            return (
              <article key={g.name} className="card" style={{ margin: 0 }} aria-labelledby={`g-${gi}`}>
                <h3 className="card-title" id={`g-${gi}`}>
                  {!overlapping ? <span className="legend-swatch" style={{ background: GROUP_COLORS[gi % GROUP_COLORS.length] }} /> : null}
                  {g.name} <span className="muted small">({g.studentIds.length}명)</span>
                </h3>
                {g.bundle ? (
                  <p className="small">
                    묶음 개념 중 하나 이상에서 현재 기준 이상인 학생 <strong>{g.studentIds.length}명</strong>
                    {!edits ? <span className="muted"> (모든 개념에서 기준 이상: {bundleResults[gi]?.members.filter((x) => x.perConcept.every((p) => p.meets)).length ?? 0}명)</span> : null}
                  </p>
                ) : null}
                {g.conceptId ? (
                  <p className="small muted">근거 문항: {tagged.map((id) => `Q${itemById.get(id)?.number}`).join(", ") || "없음 (자료 없음)"}</p>
                ) : null}
                {cluster ? (
                  <>
                    <p className="small">
                      주로 틀린 개념:{" "}
                      {repConcept.length ? repConcept.map((c) => `${c.name} ${pct(cluster.conceptMeans[c.id] ?? null)}`).join(", ") : <span className="muted">뚜렷한 공통 개념 없음 (구성원 평균 50% 미만)</span>}
                    </p>
                    <p className="small muted">
                      공통 오답 문항(구성원 절반 이상): {cluster.commonWrongItems.map((x) => `Q${itemById.get(x.itemId)?.number} (${x.wrong}/${cluster.studentIds.length})`).join(", ") || "없음"}
                    </p>
                    {edits ? <p className="small muted">※ 위 요약은 수정 전 제안 기준입니다.</p> : null}
                  </>
                ) : null}
                {g.studentIds.length === 0 ? <p className="muted small">해당 학생 없음</p> : null}
                <ul className="member-list">
                  {g.studentIds.map((sid) => {
                    const evidence = g.conceptId ? studentConcept(m, qmatrix, sid, g.conceptId) : null;
                    return (
                      <li key={sid}>
                        <Link href={`/quiz/${ds.quiz.id}/student/${sid}/`}>{name(sid)}</Link>
                        {evidence ? <span className="muted">{evidence.numerator}/{evidence.denominator}</span> : null}
                        {g.bundle ? (
                          <span className="small">
                            {g.bundle.conceptIds.map((c) => {
                              const ev = studentConcept(m, qmatrix, sid, c);
                              const meets = ev.value !== null && ev.numerator > 0 && ev.value >= threshold - 1e-12;
                              return (
                                <span key={c} className={meets ? undefined : "muted"} style={{ marginRight: 6 }}>
                                  {conceptById.get(c)?.name} {ev.numerator}/{ev.denominator}
                                  {meets ? " (기준 이상)" : ""}
                                </span>
                              );
                            })}
                          </span>
                        ) : null}
                        {overlapping ? (
                          <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`${g.name}에서 ${name(sid)} 빼기`} onClick={() => removeMember(gi, sid)}>×</button>
                        ) : (
                          <select aria-label={`${name(sid)} 이동`} value={gi} onChange={(e) => moveMember(gi, sid, Number(e.target.value))}>
                            {groups.map((gg, j) => <option key={j} value={j}>{gg.name}</option>)}
                            <option value={-1}>제외</option>
                          </select>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {overlapping && nonMembers.length ? (
                  <div className="btn-row" style={{ marginTop: "0.5rem" }}>
                    <label className="small" htmlFor={`add-${gi}`}>학생 추가</label>
                    <select id={`add-${gi}`} value="" onChange={(e) => e.target.value && addMember(gi, e.target.value)}>
                      <option value="">선택…</option>
                      {nonMembers.map((s) => {
                        const ev = g.conceptId ? studentConcept(m, qmatrix, s.id, g.conceptId) : null;
                        return <option key={s.id} value={s.id}>{s.name}{ev ? ` (${ev.numerator}/${ev.denominator})` : ""}</option>;
                      })}
                    </select>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="card" aria-labelledby="decide-title">
        <h2 className="card-title" id="decide-title">
          결정
          <InfoTip label="결정">
            <span>결정은 이 브라우저에만 저장됩니다. 실제 수업 그룹을 만들거나 학생에게 알리지 않습니다.</span>
          </InfoTip>
        </h2>
        <div className="btn-row" style={{ marginBottom: "0.75rem" }}>
          <label htmlFor="reason" className="small">보류·거부 사유 (선택)</label>
          <input id="reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 문항 수가 적어 다음 퀴즈 후 다시 판단" style={{ flex: "1 1 260px", padding: "0.3125rem 0.5rem", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", font: "inherit" }} />
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={save} disabled={groups.every((g) => g.studentIds.length === 0)}>이 브라우저에 그룹안 저장</button>
          <button type="button" className="btn btn-secondary" onClick={defer}>그룹화 보류 — 개별 분석 유지</button>
          <button type="button" className="btn btn-outline" onClick={reject}>이번 제안 거부</button>
          <span role="status" className="small">{message}</span>
        </div>
      </section>
    </div>
  );
}
