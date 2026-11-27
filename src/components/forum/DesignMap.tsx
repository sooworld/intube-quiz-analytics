"use client";
// 설계 지도 (bc-methodology.md T3, b0-prereg.md §4). 학생 글 없이 과제 설계를 점검한다.
// 1) 교수가 목표 × 하위 논점 체크표의 모든 칸을 먼저 판정한다(F3). 2) 그다음 도구의 요구 판정과 어휘 연관도를 연다.
// "관련 있다"와 "요구한다"를 구분한다. 어휘 연관도(TF-IDF)는 요구 판정으로 쓰지 않는다(S1).
// 미검토(빈칸)와 무관을 나누고, 검토 필요인 도구 칸은 "미확정"으로 두어 공백 계산에서 뺀다(Codex 구현 검토 1·6).
import { useId, useMemo, useState } from "react";
import { AiRunStatus } from "@/components/ai/AiRunStatus";
import { DetailPromptToggle } from "@/components/ai/DetailPromptToggle";
import { InfoTip } from "@/components/moodle/InfoTip";
import { CaveatNote } from "@/components/moodle/PageParts";
import { SyllabusRef } from "@/components/syllabus/SyllabusRef";
import { forumDesignBasis, forumDesignTask, forumDesignTaskV2, type DesignCellResult } from "@/lib/ai/tasks/forumDesign";
import { useAiSettings } from "@/lib/ai/useAiSettings";
import { taskUsesMock, useDraftRun } from "@/lib/ai/useDraftRun";
import {
  cellState,
  COMMON,
  designGaps,
  diffChecklists,
  fitForum,
  isComplete,
  qDocument,
  syllabusDesignMap,
  type CellState,
  type Checklist,
  type SyllabusCell,
} from "@/lib/forum/analysis";
import { designInput, objectiveDetailSentences } from "@/lib/forum/inputs";
import { cycleJudgment, exampleChecklist, markedCount, setCell } from "@/lib/forum/state";
import { CELL_LABEL, cellKey, type CellJudgment, type ForumDataset } from "@/lib/forum/types";
import { formatDateTime } from "@/lib/format";
import { useForum } from "@/lib/state/ForumContext";
import { getSyllabus } from "@/lib/syllabus/registry";
import { refScopeLabel, syllabusItem } from "@/lib/syllabus/resolve";
import type { Syllabus } from "@/lib/syllabus/types";
import { ToolLabel } from "./parts";

const colLabel = (t: string) => (t === COMMON ? "공통" : t);
const stateLabel = (s: CellState, unsetText: string) => (s === "unset" ? unsetText : CELL_LABEL[s]);

function Gaps({ ds, cl, title, unsetText }: { ds: ForumDataset; cl: Checklist; title: string; unsetText: string }) {
  const g = designGaps(ds, cl);
  return (
    <div>
      <h3>{title}</h3>
      <p className="small" style={{ margin: 0 }}>
        필수로 요구되지 않는 목표: <strong>{g.uncoveredObjectives.join(", ") || "없음"}</strong>
      </p>
      <p className="small" style={{ margin: 0 }}>
        목표와 이어지지 않는 하위 논점: <strong>{g.unlinkedQuestions.join(", ") || "없음"}</strong>
      </p>
      {g.pendingObjectives.length + g.pendingQuestions.length > 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {unsetText} 칸이 있어 아직 모름: {[...g.pendingObjectives, ...g.pendingQuestions].join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function Matrix({
  ds,
  caption,
  value,
  onCell,
  diff,
  pressed,
  unsetText,
}: {
  ds: ForumDataset;
  caption: string;
  value: (oid: string, t: string) => CellState;
  onCell: (oid: string, t: string) => void;
  diff?: (oid: string, t: string) => boolean;
  pressed?: string | null;
  unsetText: string;
}) {
  const targets = [...ds.subQuestions.map((q) => q.id), COMMON];
  const syl = getSyllabus(ds.forum.courseId);
  return (
    <div className="table-wrap">
      <table className="dm-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">목표</th>
            {targets.map((t) => (
              <th key={t} scope="col" className={t === COMMON ? "dm-common" : undefined} title={t === COMMON ? "안내 글의 공통 제출 요건" : ds.subQuestions.find((q) => q.id === t)?.text}>
                {colLabel(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ds.objectives.map((o) => (
            <tr key={o.id}>
              <th scope="row" className="dm-obj">
                <span className="id">{o.id}</span>
                <span className="small">{o.text}</span> <span className="badge">{o.kind === "content" ? "내용" : "역량"}</span>
                <SylRef syl={syl} syllabusId={o.syllabusId} />
              </th>
              {targets.map((t) => {
                const s = value(o.id, t);
                const d = diff?.(o.id, t) ?? false;
                return (
                  <td key={t} className={t === COMMON ? "dm-common" : undefined}>
                    <button
                      type="button"
                      className="dm-cell"
                      data-j={s}
                      data-diff={d ? "true" : undefined}
                      aria-pressed={pressed !== undefined ? pressed === cellKey(o.id, t) : undefined}
                      aria-label={`${o.id} × ${colLabel(t)}: ${stateLabel(s, unsetText)}${d ? ", 체크표와 다름" : ""}`}
                      onClick={() => onCell(o.id, t)}
                    >
                      {s === "unset" ? "" : CELL_LABEL[s]}
                      {d ? <span className="visually-hidden"> (다름)</span> : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 목표 행 머리의 계획서 링크. 계획서 목표를 못 찾으면 아무것도 그리지 않는다 */
function SylRef({ syl, syllabusId }: { syl: Syllabus | null; syllabusId?: string }) {
  const si = syl && syllabusId ? syllabusItem(syl, syllabusId) : null;
  if (!syl || !si) return null;
  return (
    <span className="dm-syl">
      {" "}
      <SyllabusRef courseId={syl.courseId} item={si} />
    </span>
  );
}

export function DesignMap() {
  const { ds, ready, checklist, saveChecklist, checklistStatus, latestDesign, latestDesignAttempt, addDraft } = useForum();
  // v2(계획서 상세 포함)는 기본으로 켠다. Mock이면 v1으로 실행한다(DetailPromptToggle)
  const [withDetail, setWithDetail] = useState(true);
  const usesMock = taskUsesMock(useAiSettings(), "forum-design");
  const v2 = withDetail && !usesMock;
  const inputV1 = useMemo(() => designInput(ds), [ds]);
  const inputV2 = useMemo(() => designInput(ds, { withDetail: true }), [ds]);
  const basisV1 = useMemo(() => forumDesignBasis(inputV1, forumDesignTask), [inputV1]);
  const basisV2 = useMemo(() => forumDesignBasis(inputV2, forumDesignTaskV2), [inputV2]);
  const input = v2 ? inputV2 : inputV1;
  const basis = v2 ? basisV2 : basisV1;
  const run = useDraftRun(v2 ? forumDesignTaskV2 : forumDesignTask, { quizId: ds.forum.id, dataVersion: ds.dataVersion, addDraft });
  const [reveal, setReveal] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const total = ds.objectives.length * (ds.subQuestions.length + 1);
  const marked = markedCount(checklist);
  const complete = isComplete(ds, checklist.cells);
  const prof = checklist.cells;
  // 초안은 자기 프롬프트 버전의 입력과 비교한다(체크박스를 바꿨다고 이전 버전 판정이 낡은 것은 아니다)
  const draft = latestDesign && latestDesign.basisHash === (latestDesign.promptVersion === forumDesignTaskV2.promptVersion ? basisV2 : basisV1) ? latestDesign : null;
  const lastFailed = latestDesignAttempt && latestDesignAttempt.result.status === "invalid" && latestDesignAttempt.draftId !== draft?.draftId ? latestDesignAttempt : null;
  // 검토 필요 칸은 넣지 않는다(미확정). 공백 계산에서 "아직 모름"으로 남는다
  const tool: Checklist = useMemo(() => {
    const out: Record<string, CellJudgment> = {};
    for (const c of draft?.result.cells ?? []) if (c.issues.length === 0) out[cellKey(c.objectiveId, c.target)] = c.judgment;
    return out as Checklist;
  }, [draft]);
  const reviewCount = draft?.result.cells.filter((c) => c.issues.length > 0).length ?? 0;
  const diffs = draft ? diffChecklists(ds, prof, tool) : [];
  const diffSet = new Set(diffs.map((d) => cellKey(d.objectiveId, d.target)));
  const cellOf = (key: string): DesignCellResult | undefined => draft?.result.cells.find((c) => cellKey(c.objectiveId, c.target) === key);
  const open = reveal && complete;
  const now = () => new Date().toISOString();

  return (
    <div className="stack">
      {checklistStatus === "session-only" || run.unsaved ? <CaveatNote>브라우저 저장소를 쓸 수 없어 이번 세션에만 반영됩니다. 새로고침하면 사라집니다.</CaveatNote> : null}
      <section className="card" aria-labelledby="dm-mine">
        <h2 className="card-title" id="dm-mine">
          1. 내 체크표 (먼저)
          <InfoTip label="내 체크표">
            <span>
              칸을 누를 때마다 무관 → 선택 → 필수로 바뀝니다. 빈칸은 아직 판정하지 않은 칸입니다. <strong>필수</strong>는 그 목표에 적힌 수행 없이는 하위 논점에 충실히 답할 수 없다는 뜻입니다. 관련된 단어가 있다는 것만으로는 필수가 아닙니다.
              <strong> 공통</strong> 열은 안내 글이 모든 글·답글에 요구하는 공통 제출 요건입니다.
            </span>
          </InfoTip>
        </h2>
        <Matrix
          ds={ds}
          caption="내 체크표: 목표 × 하위 논점"
          unsetText="미검토"
          value={(o, t) => cellState(prof, o, t)}
          onCell={(o, t) => saveChecklist(setCell(checklist, cellKey(o, t), cycleJudgment(cellState(prof, o, t)), now()))}
        />
        <div className="btn-row" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => saveChecklist(exampleChecklist(ds, now()))} disabled={!ready}>
            예시로 채우기
          </button>
          <button type="button" className="btn btn-sm btn-link" onClick={() => saveChecklist({ ...checklist, cells: {}, source: "manual", updatedAt: now() })} disabled={marked === 0}>
            모두 지우기
          </button>
          <span className="small muted">
            판정 {marked}/{total}칸
            {checklist.source !== "manual" ? " · 설계자 예시로 채움" : null}
            {checklist.source === "example-edited" ? " · 고침" : null}
            {checklist.updatedAt && checklistStatus !== "session-only" ? ` · ${formatDateTime(checklist.updatedAt)} 저장` : null}
          </span>
        </div>
        {marked > 0 ? (
          <div className="dm-gaps">
            <Gaps ds={ds} cl={prof} title="내 체크표 기준" unsetText="미검토" />
          </div>
        ) : null}
      </section>

      <section className="card" aria-labelledby="dm-tool">
        <h2 className="card-title" id="dm-tool">
          2. 도구 결과와 비교
          <InfoTip label="도구 결과">
            <span>
              도구가 칸마다 필수·선택·무관과 근거 문구를 냅니다. 체크표와 다른 칸은 점선 테두리입니다. 근거 문구가 하위 논점 문장에 없는 칸은 ‘미확정’으로 두고 공백 계산에서 뺍니다. 세 방법(체크표·도구·어휘)이 같다고 그 판정이 맞다는 증거는 아닙니다.
            </span>
          </InfoTip>
        </h2>
        {!complete ? (
          <p className="small">
            내 체크표의 모든 칸(무관 포함)을 판정하면 도구 결과를 열 수 있습니다. 지금 {marked}/{total}칸. 먼저 판단하고 비교해야 도구 결과에 끌려가지 않습니다.
          </p>
        ) : !open ? (
          <button type="button" className="btn btn-primary" onClick={() => setReveal(true)}>
            도구 결과 열기
          </button>
        ) : (
          <>
            <DetailPromptToggle checked={withDetail} onChange={setWithDetail} usesMock={usesMock} disabled={run.busy} />
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={() => void run.run(input, basis)} disabled={run.busy || !ready}>
                {draft ? "요구 판정 다시 실행" : "요구 판정 실행"}
              </button>
              <span className="small muted">{run.modelLabel}</span>
              {draft ? <ToolLabel provider={draft.provider} model={draft.responseModel} /> : null}
              {draft && draft.provider !== "mock" ? <span className="small muted">프롬프트 {draft.promptVersion}</span> : null}
            </div>
            <AiRunStatus busy={run.busy} wait={run.wait} error={run.error} retryable={run.retryable} idleMessage={null} onRetry={() => void run.run(input, basis)} />
            {lastFailed ? (
              <CaveatNote>
                마지막 실행({formatDateTime(lastFailed.createdAt)})은 형식 오류라 쓰지 않았습니다{draft ? ` · 아래는 ${formatDateTime(draft.createdAt)} 결과입니다` : ""}. {lastFailed.result.problems.slice(0, 2).join(" ")}
              </CaveatNote>
            ) : null}
            {latestDesign && !draft ? <CaveatNote>과제 내용이 바뀌어 이전 판정은 쓰지 않습니다. 다시 실행하세요.</CaveatNote> : null}
            {draft ? (
              <>
                {reviewCount > 0 ? <CaveatNote>검토 필요 {reviewCount}칸은 미확정으로 두었습니다: {draft.result.problems.join(" ")}</CaveatNote> : null}
                <Matrix
                  ds={ds}
                  caption="도구의 요구 판정"
                  unsetText="미확정"
                  value={(o, t) => cellState(tool, o, t)}
                  onCell={(o, t) => setSelected(cellKey(o, t) === selected ? null : cellKey(o, t))}
                  diff={(o, t) => diffSet.has(cellKey(o, t))}
                  pressed={selected}
                />
                {selected ? <CellDetail ds={ds} cell={cellOf(selected)} prof={prof} /> : <p className="small muted">칸을 누르면 도구가 옮긴 근거 문구와 이유가 보입니다.</p>}
                <div className="dm-gaps">
                  <Gaps ds={ds} cl={prof} title="내 체크표 기준" unsetText="미검토" />
                  <Gaps ds={ds} cl={tool} title="도구 판정 기준" unsetText="미확정" />
                  <div>
                    <h3>다른 칸</h3>
                    <p className="small" style={{ margin: 0 }}>
                      {diffs.length === 0
                        ? "없음"
                        : diffs.map((d) => `${d.objectiveId}×${colLabel(d.target)} (나 ${stateLabel(d.a, "미검토")} / 도구 ${stateLabel(d.b, "미확정")})`).join(", ")}
                    </p>
                  </div>
                </div>
              </>
            ) : null}

            <LexicalMap ds={ds} />
          </>
        )}
      </section>
    </div>
  );
}

type LexMode = "syllabus" | "b2";

/** 어휘 연관도 (S1, docs/decisions.md U19). 기본은 계획서 상세 문장 포함(문장별 최댓값), 토글로 사전 등록 B2 설정(목표 문장만).
 *  B2 값(sentenceCosine)은 lexicalDesignMap과 같다(tests/syllabus-ai.test.ts) */
function LexicalMap({ ds }: { ds: ForumDataset }) {
  const v = useMemo(() => fitForum(ds), [ds]);
  const sents = useMemo(() => objectiveDetailSentences(ds), [ds]);
  const cells = useMemo(() => syllabusDesignMap(ds, sents, v), [ds, sents, v]);
  const hasDetail = Object.keys(sents).length > 0;
  const [mode, setMode] = useState<LexMode>(hasDetail ? "syllabus" : "b2");
  const [selected, setSelected] = useState<string | null>(null);
  const name = useId();
  const syl = getSyllabus(ds.forum.courseId);
  const targets = [...ds.subQuestions.map((q) => q.id), COMMON];
  const value = (c: SyllabusCell) => (mode === "syllabus" ? c.cosine : c.sentenceCosine);
  const max = Math.max(...cells.map(value), 0.0001);
  const raised = cells.filter((c) => c.sourceIndex >= 0).length;
  const cellAt = (o: string, t: string) => cells.find((c) => c.objectiveId === o && c.target === t)!;
  const sel = selected ? cells.find((c) => cellKey(c.objectiveId, c.target) === selected) : undefined;

  return (
    <details style={{ marginTop: "1rem" }}>
      <summary className="small">어휘 연관도 (TF-IDF) 보기</summary>
      <p className="dm-lex-warning" role="note">
        <strong>어휘 연관도 · 요구 여부가 아님</strong> · 계획서 상세는 기존 활동에서 거꾸로 쓴 것이라 독립 검증값이 아님 · 문장이 많을수록 우연히 높아질 수 있음
      </p>
      <p className="small">
        목표 문장(과 계획서 상세 문장)이 하위 논점 문장과 글자 조각을 얼마나 함께 쓰는지(0~1)입니다. 짧은 문장끼리라 대부분 0에 가깝고, 합성 과제 실험(B2)에서 이 값으로 설계 공백을 찾는 규칙은 작동하지 않았습니다.
      </p>
      {hasDetail ? (
        <fieldset className="dm-lex-mode">
          <legend className="small">비교할 문장</legend>
          <label className="small">
            <input type="radio" name={name} checked={mode === "syllabus"} onChange={() => setMode("syllabus")} /> 계획서 상세 포함 (문장별 최댓값)
          </label>
          <label className="small">
            <input type="radio" name={name} checked={mode === "b2"} onChange={() => setMode("b2")} /> 목표 문장만 (사전 등록 B2 설정)
          </label>
        </fieldset>
      ) : null}
      {mode === "syllabus" ? (
        <p className="small muted">
          계획서 상세의 한 문장이 목표 문장보다 가까운 칸({raised}/{cells.length}칸)은 값 아래에 “상세 n”을 붙였습니다. 값은 목표 문장만 쓴 값보다 낮아지지 않습니다.
        </p>
      ) : null}
      <div className="table-wrap">
        <table className="dm-table">
          <caption className="visually-hidden">어휘 연관도 ({mode === "syllabus" ? "계획서 상세 포함" : "목표 문장만"})</caption>
          <thead>
            <tr>
              <th scope="col">목표</th>
              {targets.map((t) => (
                <th key={t} scope="col" className={t === COMMON ? "dm-common" : undefined}>
                  {colLabel(t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ds.objectives.map((o) => (
              <tr key={o.id}>
                <th scope="row">{o.id}</th>
                {targets.map((t) => {
                  const c = cellAt(o.id, t);
                  const val = value(c);
                  const step = Math.min(4, Math.round((val / max) * 4));
                  const fromDetail = mode === "syllabus" && c.sourceIndex >= 0;
                  const key = cellKey(o.id, t);
                  return (
                    <td key={t} className={t === COMMON ? "dm-common" : undefined}>
                      <button
                        type="button"
                        className="dm-lex"
                        style={{ background: `var(--seq-${step})`, color: step >= 4 ? "#fff" : "var(--text)" }}
                        aria-pressed={selected === key}
                        aria-label={`${o.id} × ${colLabel(t)}: ${val.toFixed(2)}${fromDetail ? `, 계획서 상세 ${c.sourceIndex + 1}번째 문장` : ""}`}
                        onClick={() => setSelected(selected === key ? null : key)}
                      >
                        <span>{val.toFixed(2)}</span>
                        {fromDetail ? <span className="dm-lex-src">상세 {c.sourceIndex + 1}</span> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel ? <LexDetail ds={ds} cell={sel} mode={mode} syl={syl} /> : <p className="small muted">칸을 누르면 출처 문장과 계산 조건이 보입니다.</p>}
    </details>
  );
}

function LexDetail({ ds, cell, mode, syl }: { ds: ForumDataset; cell: SyllabusCell; mode: LexMode; syl: Syllabus | null }) {
  const o = ds.objectives.find((x) => x.id === cell.objectiveId)!;
  const si = syl && o.syllabusId ? syllabusItem(syl, o.syllabusId) : null;
  const fromDetail = mode === "syllabus" && cell.sourceIndex >= 0;
  const target = cell.target === COMMON ? ds.forum.intro : qDocument(ds, cell.target);
  return (
    <div className="alert alert-info" style={{ marginTop: "0.75rem" }}>
      <p style={{ margin: 0 }}>
        <strong>
          {o.id} × {colLabel(cell.target)}
        </strong>
        {si && syl ? (
          <>
            {" "}
            · 계획서 항목{" "}
            <SyllabusRef courseId={syl.courseId} item={si}>
              {si.id}
            </SyllabusRef>{" "}
            ({refScopeLabel(si)})
          </>
        ) : null}
      </p>
      <p className="small" style={{ margin: "0.25rem 0 0" }}>
        값 {(mode === "syllabus" ? cell.cosine : cell.sentenceCosine).toFixed(3)} · 목표 문장만(B2) {cell.sentenceCosine.toFixed(3)}
        {fromDetail ? ` · 계획서 상세 ${cell.sourceIndex + 1}번째 문장이 더 가까움(+${(cell.cosine - cell.sentenceCosine).toFixed(3)})` : ""}
      </p>
      <p className="small" style={{ margin: "0.25rem 0 0" }}>
        출처 문장({fromDetail ? `계획서 상세 ${cell.sourceIndex + 1}번째` : "목표 문장"}): “{fromDetail ? cell.sourceText : o.text}”
      </p>
      <p className="small muted" style={{ margin: "0.25rem 0 0" }}>
        비교 대상({cell.target === COMMON ? "안내 글" : "하위 논점 문장 + 토론 주제"}): {target}
      </p>
      <p className="small muted" style={{ margin: "0.25rem 0 0" }}>
        계산: 문자 2–4그램 TF-IDF 코사인. 모델은 사전 등록 말뭉치(목표·하위 논점·주제·안내 글·원본 글)로 적합한 그대로 고정
        {mode === "syllabus" ? ". 목표 문장과 계획서 상세의 각 문장을 따로 재어 가장 큰 값을 씀(이어 붙이지 않음)." : "."}
      </p>
    </div>
  );
}

function CellDetail({ ds, cell, prof }: { ds: ForumDataset; cell: DesignCellResult | undefined; prof: Checklist }) {
  if (!cell) return null;
  const q = cell.target === COMMON ? ds.forum.intro : ds.subQuestions.find((x) => x.id === cell.target)?.text;
  return (
    <div className="alert alert-info" style={{ marginTop: "0.75rem" }}>
      <p style={{ margin: 0 }}>
        <strong>
          {cell.objectiveId} × {colLabel(cell.target)}
        </strong>{" "}
        도구 {cell.issues.length > 0 ? "미확정" : CELL_LABEL[cell.judgment]} / 나 {stateLabel(cellState(prof, cell.objectiveId, cell.target), "미검토")}
      </p>
      {cell.quote ? (
        <p className="small" style={{ margin: "0.25rem 0 0" }}>
          근거 문구: “{cell.quote}” {cell.issues.length > 0 ? <span className="badge badge-danger">검토 필요</span> : <span className="badge">문장에 있음 확인</span>}
        </p>
      ) : null}
      <p className="small" style={{ margin: "0.25rem 0 0" }}>이유 (미검증 설명): {cell.reason}</p>
      <p className="small muted" style={{ margin: "0.25rem 0 0" }}>{q}</p>
    </div>
  );
}
