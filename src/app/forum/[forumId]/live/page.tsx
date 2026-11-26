// 실연 기록 탭: LG EXAONE으로 토론 작업을 실제로 돌린 기록(2026-11-26)을 그대로 보여 준다.
// 기본 체험은 Mock이고, 이 탭은 별도 기록이다. 잘 된 사례만 고르지 않고 실패·검토 필요·불일치·지연을 함께 보인다(Codex 균형 검토 8).
// 원본: tests/fixtures/live/forum-*-k-exaone_v2.5-2026-11-26*.json → npm run forum:s5 가 src/data/forum-live-lg.json 으로 요약한다.
import { notFound } from "next/navigation";
import { FactText } from "@/components/forum/parts";
import { InfoTip } from "@/components/moodle/InfoTip";
import { CaveatNote } from "@/components/moodle/PageParts";
import live from "@/data/forum-live-lg.json";
import { getForum } from "@/lib/data";
import type { ForumFact } from "@/lib/forum/facts";
import { RESPONSE_FUNCTION_LABEL, SPECIAL_TARGET_LABEL, type ResponseFunction } from "@/lib/forum/types";

export const metadata = { title: "실연 기록" };

const STATUS: Record<string, string> = { valid: "검증 통과", "needs-review": "검토 필요", invalid: "사용 불가" };
const RUN: Record<string, string> = { "1": "1차 · 기본 설정", "2": "2차 · 상한 16000, 6개씩", "429": "서비스 과부하(429)", "3": "3차 · 첨언 프롬프트 v2", "4": "4차 · 구조 변경 확인" };
const TASK: Record<string, string> = { design: "설계 판정", profile: "글별 근거", comment: "첨언" };
const label = (t: string) => (t === "new" || t === "off" || t === "hold" ? SPECIAL_TARGET_LABEL[t] : t);

interface Call {
  file: string;
  run: string;
  ok: boolean;
  recorded: string | null;
  current: string | null;
  seconds: number;
  tokens: number | null;
  error: string | null;
}

interface CommentRun {
  run: string;
  promptVersion?: string;
  seconds: number;
  recorded: string | null;
  current: string;
  problems: string[];
  facts: ForumFact[];
  items: { focus: string; fields: Record<string, string>; issues: string[] }[];
}

interface ForumLive {
  design?: { status: string; gapsDesigner: string[]; gapsLlm: string[]; diffCells: number; o4RequiredQs: number; totalQs: number; o3q2: string | null; seconds: number };
  profile?: {
    status: string;
    batches: number[];
    review: { id: string; issues: string[] }[];
    agreePrimary: number;
    agreeRule: number;
    agreeFunction: number;
    total: number;
    ruleFailures: { id: string; roles: string[]; intent: string; rule: string; llm: string; secondary: string[]; review: boolean; quote: string | null }[];
    outside: { id: string; intent: string; llm: string; rule: string }[];
  };
  comments?: CommentRun[];
  profileV3?: { status?: string; seconds?: number; error?: string; posts?: { id: string; llm: string; fn: ResponseFunction; intent: string; intentFn: ResponseFunction; review: boolean }[] };
}

export function generateStaticParams() {
  return Object.keys(live.forums).map((forumId) => ({ forumId }));
}

export default async function ForumLivePage({ params }: { params: Promise<{ forumId: string }> }) {
  const { forumId } = await params;
  const ds = getForum(forumId);
  if (!ds) notFound();
  const f = (live.forums as Record<string, ForumLive>)[forumId] ?? {};
  const taskOf = (file: string) => TASK[/^forum-(design|profile|comment)-/.exec(file)?.[1] ?? ""] ?? file;
  const part = (file: string) => /-(b\d)-/.exec(file)?.[1] ?? "";
  // 실행 순서대로: 차수(1 → 2 → 429 → 3 → 4), 작업(설계 → 글별 → 첨언), 묶음
  const runRank: Record<string, number> = { "1": 0, "2": 1, "429": 2, "3": 3, "4": 4 };
  const taskRank = (file: string) => ["design", "profile", "comment"].indexOf(/^forum-(design|profile|comment)-/.exec(file)?.[1] ?? "");
  const calls = (live.calls as Call[])
    .filter((c) => c.file.includes(`-${forumId}-`))
    .sort((a, b) => (runRank[a.run] ?? 9) - (runRank[b.run] ?? 9) || taskRank(a.file) - taskRank(b.file) || part(a.file).localeCompare(part(b.file)));

  return (
    <div className="stack">
      <section className="card" aria-labelledby="live-head">
        <h2 className="card-title" id="live-head">
          실제 LLM 실연 기록
          <InfoTip label="실연 기록">
            <span>
              이 토론의 합성 글로 LG EXAONE({live.model})을 {live.date}에 실제로 돌린 기록입니다. 다른 탭의 결과(규칙 기반 Mock)와 별개이며, 이 화면의 결과는 교수 기록이나 집계에 들어가지 않습니다. 의도 라벨은 글을 쓴 사람이 단 것이라, 일치해도 성능 근거가 아닙니다.
            </span>
          </InfoTip>
        </h2>
        <p className="forum-provenance" style={{ margin: 0 }}>
          <span className="badge badge-warn">실연 기록 · 1회 실행 · 성능 근거 아님</span>
          <span>{live.note}</span>
        </p>
      </section>

      <section className="card" aria-labelledby="live-calls">
        <h2 className="card-title" id="live-calls">
          호출과 시간
          <InfoTip label="호출과 시간">
            <span>1차는 작업 기본 설정(출력 상한 4096, 글 18개 한 번에)이라 모두 실패했습니다. 2차부터 상한을 올리고 글을 6개씩 나눴습니다. 이 앱의 토론 작업 제한 시간은 그래서 300초입니다.</span>
          </InfoTip>
        </h2>
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">실연 호출 목록</caption>
            <thead>
              <tr>
                <th scope="col">차수</th>
                <th scope="col">작업</th>
                <th scope="col">결과</th>
                <th scope="col">판정 (기록 당시 → 지금)</th>
                <th scope="col" className="num">초</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.file}>
                  <td>{RUN[c.run] ?? c.run}</td>
                  <td>
                    {taskOf(c.file)} {part(c.file)}
                  </td>
                  <td>{c.ok ? "응답 받음" : `실패 (${c.error === "truncated" ? "출력 상한에서 잘림" : c.error === "timeout" ? "시간 초과" : c.error === "rate-limit" ? "서비스 과부하" : c.error})`}</td>
                  <td>{c.ok ? `${STATUS[c.recorded ?? ""] ?? "—"} → ${STATUS[c.current ?? ""] ?? "—"}` : "—"}</td>
                  <td className="num">{c.seconds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {f.design ? (
        <section className="card" aria-labelledby="live-design">
          <h2 className="card-title" id="live-design">설계 판정 (2차)</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li>
              설계 공백: 설계자 예시 {f.design.gapsDesigner.join(", ") || "없음"} · LLM {f.design.gapsLlm.join(", ") || "없음"}
            </li>
            <li>설계자 예시와 다른 칸 {f.design.diffCells}개</li>
            <li>
              역량 목표 O4를 <strong>하위 논점 {f.design.o4RequiredQs}/{f.design.totalQs}개에서 필수</strong>로 판정 — 공통 요건 이상만 하위 논점 칸에 적는다는 기준과 다릅니다(요구 구분 실패의 유력 사례).
            </li>
            {f.design.o3q2 ? <li>O3×Q2(규칙은 &quot;다양성&quot; 단어로 필수라고 잘못 판정): LLM {f.design.o3q2 === "optional" ? "선택" : f.design.o3q2} — 규칙의 오류는 피했지만 설계자 예시(무관)와도 다릅니다.</li> : null}
          </ul>
        </section>
      ) : null}

      {f.profile ? (
        <section className="card" aria-labelledby="live-profile">
          <h2 className="card-title" id="live-profile">글별 근거 (2차, 6개씩 {f.profile.batches.length}묶음)</h2>
          <p className="small">
            검증: {STATUS[f.profile.status]} · 근거 검증에 걸린 글 {f.profile.review.length}/{f.profile.total}
            {f.profile.review.length ? ` (${f.profile.review.map((r) => r.id).join(", ")}: 근거 문장 자리에 실제 문장 대신 "..."를 냄)` : ""} · 의도 라벨과 같은 주 배정 LLM {f.profile.agreePrimary}/{f.profile.total}, 규칙 {f.profile.agreeRule}/{f.profile.total}
          </p>
          <h3 className="small" style={{ margin: "0.5rem 0 0.25rem" }}>미리 정한 &quot;규칙이 틀린 글&quot;</h3>
          <div className="table-wrap">
            <table className="data">
              <caption className="visually-hidden">규칙 실패 사례에서 LLM 결과</caption>
              <thead>
                <tr>
                  <th scope="col">글</th>
                  <th scope="col">의도</th>
                  <th scope="col">규칙</th>
                  <th scope="col">LLM</th>
                  <th scope="col">근거 검증</th>
                </tr>
              </thead>
              <tbody>
                {f.profile.ruleFailures.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{label(r.intent)}</td>
                    <td>{label(r.rule)}</td>
                    <td>
                      {label(r.llm)}
                      {r.secondary.length ? ` (+${r.secondary.join(", ")})` : ""}
                    </td>
                    <td>{r.review ? "검토 필요" : "통과"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {f.profile.outside.length > 0 ? (
            <p className="small">
              선정 사례 밖 불일치 {f.profile.outside.length}건: {f.profile.outside.map((o) => `${o.id}(의도 ${label(o.intent)} / LLM ${label(o.llm)}${o.rule === o.llm ? ", 규칙도 같음" : ""})`).join(" · ")}. 참조 라벨이 맞는지도 함께 따져 볼 일입니다.
            </p>
          ) : null}
        </section>
      ) : null}

      {f.profileV3?.posts ? (
        <section className="card" aria-labelledby="live-v3">
          <h2 className="card-title" id="live-v3">
            글별 근거 4차 (다른 묶음의 부모 글을 문맥으로 넘김)
          </h2>
          <p className="small">
            검증: {STATUS[f.profileV3.status ?? ""]} · {f.profileV3.seconds}초
          </p>
          <ul className="small" style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {f.profileV3.posts.map((p) => (
              <li key={p.id}>
                {p.id}: {label(p.llm)} · {RESPONSE_FUNCTION_LABEL[p.fn]} (의도 {label(p.intent)} · {RESPONSE_FUNCTION_LABEL[p.intentFn]}){p.review ? " · 검토 필요" : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : f.profileV3?.error ? (
        <CaveatNote>글별 근거 4차는 실패했습니다({f.profileV3.error}).</CaveatNote>
      ) : null}

      {(f.comments ?? []).map((c) => (
        <section key={c.run} className="card" aria-labelledby={`live-c${c.run}`}>
          <h2 className="card-title" id={`live-c${c.run}`}>
            첨언 {RUN[c.run] ?? c.run} ({c.promptVersion})
          </h2>
          <p className="small">
            검증: 기록 당시 {STATUS[c.recorded ?? ""] ?? "—"} → 지금 {STATUS[c.current]} · {c.seconds}초
          </p>
          {c.problems.length ? <CaveatNote>{c.problems.join(" ")}</CaveatNote> : null}
          {c.items.map((it, k) => (
            <div key={k} className="cm-item">
              <dl>
                <dt>관찰</dt>
                <dd>
                  <FactText text={it.fields.observation ?? ""} facts={c.facts} />
                </dd>
                <dt>해석</dt>
                <dd>
                  <span className="mark-guess">AI 추정 · 미검증</span>
                  <FactText text={it.fields.interpretation ?? ""} facts={c.facts} />
                </dd>
                <dt>질문</dt>
                <dd>
                  <FactText text={it.fields.question ?? ""} facts={c.facts} />
                </dd>
              </dl>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
