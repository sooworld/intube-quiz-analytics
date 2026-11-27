// 강의계획서 화면 (docs/decisions.md U19, 계획 T6). 서버 컴포넌트.
// 개요 · 강좌 역량 목표 · 주차별 계획 · 항목 카드(앵커 syl-<id>, 상세, 쓰는 곳) · 평가. 가상 계획서라는 표시는 늘 보인다.
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/moodle/PageParts";
import { courseHomeHref, itemKindLabel, refScopeLabel, syllabusAnchor, syllabusHref, syllabusItem, syllabusWeekAnchor } from "@/lib/syllabus/resolve";
import type { Syllabus, SyllabusItem } from "@/lib/syllabus/types";
import type { SyllabusUse } from "@/lib/syllabus/usage";
import type { Course } from "@/lib/types";

const USE_KIND: Record<SyllabusUse["kind"], string> = { "quiz-item": "퀴즈 문항", "essay-criterion": "서술형 기준", "forum-objective": "토론 목표" };

/** 같은 활동의 쓰는 곳을 한 줄로 묶는다 (예: 5주차 퀴즈 · 6번 문항, 7번 문항) */
function groupUses(uses: SyllabusUse[]) {
  const out: { activityId: string; activityName: string; href: string; kind: SyllabusUse["kind"]; labels: string[] }[] = [];
  for (const u of uses) {
    const g = out.find((x) => x.activityId === u.activityId && x.kind === u.kind);
    if (g) g.labels.push(u.label);
    else out.push({ activityId: u.activityId, activityName: u.activityName, href: u.href, kind: u.kind, labels: [u.label] });
  }
  return out;
}

function ItemCard({ syl, item, uses }: { syl: Syllabus; item: SyllabusItem; uses: SyllabusUse[] }) {
  const anchor = syllabusAnchor(item.id);
  const title = item.type === "concept" ? item.name : item.text;
  const groups = groupUses(uses);
  const related = item.type === "objective" ? item.conceptIds.map((id) => syl.concepts.find((c) => c.id === id)).filter((c) => !!c) : [];
  return (
    <article className="syl-item" id={anchor} aria-labelledby={`${anchor}-t`}>
      <div className="syl-item-meta">
        <span className={`badge${item.type === "objective" && item.kind === "competency" ? " badge-info" : ""}`}>{itemKindLabel(item)}</span>
        <span className="badge">{refScopeLabel(item)}</span>
        <code className="syl-id">{item.id}</code>
      </div>
      <h3 id={`${anchor}-t`}>{title}</h3>
      {item.type === "concept" ? <p className="small muted">{item.description}</p> : null}
      <p className="syl-detail">{item.detail}</p>
      {related.length > 0 ? (
        <p className="small">
          다루는 개념:{" "}
          {related.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? " · " : ""}
              <Link href={`#${syllabusAnchor(c.id)}`}>{c.name}</Link>
            </span>
          ))}
        </p>
      ) : null}
      <div className="syl-uses">
        <h4>쓰는 곳</h4>
        {groups.length === 0 ? (
          <p className="small muted">평가 활동 없음</p>
        ) : (
          <ul>
            {groups.map((g) => (
              <li key={`${g.activityId}-${g.kind}`}>
                <span className="badge">{USE_KIND[g.kind]}</span> <Link href={g.href}>{g.activityName}</Link> · {g.labels.join(", ")}
              </li>
            ))}
          </ul>
        )}
        {uses.some((u) => u.kind === "quiz-item") ? <p className="small muted">퀴즈 문항은 기본 태그 기준입니다. 이 브라우저에서 고친 태그는 반영하지 않습니다.</p> : null}
      </div>
    </article>
  );
}

export function SyllabusView({ syl, course, usage, extraTabs }: { syl: Syllabus; course: Course; usage: Record<string, SyllabusUse[]>; extraTabs?: ReactNode }) {
  const courseId = course.id;
  const item = (id: string) => syllabusItem(syl, id)!;
  const competency = syl.objectives.filter((o) => o.scope.kind === "course");
  const weekly = syl.objectives.filter((o) => o.scope.kind === "weeks");
  const evalIds = new Set(syl.evaluation.flatMap((e) => e.activityIds));
  const activity = (id: string) => course.sections.flatMap((s) => s.activities).find((a) => a.id === id);
  return (
    <div className="page">
      <PageHeader title="강의계획서" crumbs={[{ label: "My courses" }, { label: course.shortName, href: courseHomeHref(courseId) }, { label: "강의계획서" }]} />
      <nav className="secondary-nav" aria-label="과정 메뉴">
        <ul>
          <li><Link href={courseHomeHref(courseId)}>Course</Link></li>
          <li><Link href={syllabusHref(courseId)} aria-current="page">강의계획서</Link></li>
          <li><span className="tab-btn muted" title="데모에서는 열리지 않음">Participants</span></li>
          <li><span className="tab-btn muted" title="데모에서는 열리지 않음">Grades</span></li>
          {extraTabs}
        </ul>
      </nav>

      <div className="alert alert-warning" role="note">
        <p>
          <span className="badge badge-demo">가상</span> {syl.provenance} 퀴즈·서술형·토론이 쓰는 개념 이름·설명과 목표 문장은 이 계획서에서 나옵니다. 계획서를 활동에서 거꾸로 만들었으므로, 계획서와 활동이 잘 맞아 보이는 것은 근거가 아닙니다.
        </p>
      </div>

      <div className="stack">
        <section className="card" aria-labelledby="syl-overview">
          <h2 className="card-title" id="syl-overview">
            {course.shortName} {course.fullName}
          </h2>
          <p style={{ margin: 0 }}>{syl.overview}</p>
        </section>

        {competency.length > 0 ? (
          <section className="card" aria-labelledby="syl-competency">
            <h2 className="card-title" id="syl-competency">강좌 역량 목표</h2>
            <p className="card-sub">한 주차에 묶이지 않고 강좌 전체에서 기르는 수행입니다.</p>
            <div className="syl-items">
              {competency.map((o) => (
                <ItemCard key={o.id} syl={syl} item={item(o.id)} uses={usage[o.id] ?? []} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="card" aria-labelledby="syl-weeks">
          <h2 className="card-title" id="syl-weeks">주차별 계획</h2>
          <div className="table-wrap">
            <table className="data syl-weeks">
              <caption className="visually-hidden">주차별 주제·내용·방법·학습 항목·평가 활동</caption>
              <thead>
                <tr>
                  <th scope="col">주차</th>
                  <th scope="col">주제와 내용</th>
                  <th scope="col">방법</th>
                  <th scope="col">학습 항목</th>
                  <th scope="col">평가 활동</th>
                </tr>
              </thead>
              <tbody>
                {syl.weeks.map((w) => {
                  const items = [...syl.concepts.filter((c) => c.weeks.includes(w.week)).map((c) => ({ id: c.id, label: c.name })), ...weekly.filter((o) => o.scope.kind === "weeks" && o.scope.weeks.includes(w.week)).map((o) => ({ id: o.id, label: `목표: ${o.text}` }))];
                  const acts = (course.sections.find((s) => s.number === w.week)?.activities ?? []).filter((a) => evalIds.has(a.id));
                  return (
                    <tr key={w.week} id={syllabusWeekAnchor(w.week)}>
                      <th scope="row">{w.week}주차</th>
                      <td>
                        <strong>{w.topic}</strong>
                        <div className="small">{w.content}</div>
                      </td>
                      <td className="small">{w.method}</td>
                      <td className="small">
                        {items.length === 0 ? (
                          <span className="muted">없음</span>
                        ) : (
                          <ul className="syl-list">
                            {items.map((x) => (
                              <li key={x.id}>
                                <Link href={`#${syllabusAnchor(x.id)}`}>{x.label}</Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="small">
                        {acts.length === 0 ? (
                          <span className="muted">평가 활동 없음</span>
                        ) : (
                          <ul className="syl-list">
                            {acts.map((a) => (
                              <li key={a.id}>{a.href ? <Link href={a.href}>{a.name}</Link> : <span title="데모에서는 열리지 않는 활동">{a.name}</span>}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" aria-labelledby="syl-concepts">
          <h2 className="card-title" id="syl-concepts">학습 개념</h2>
          <p className="card-sub">퀴즈 문항의 개념 태그와 서술형 루브릭 기준이 가리키는 항목입니다.</p>
          <div className="syl-items">
            {syl.concepts.map((c) => (
              <ItemCard key={c.id} syl={syl} item={item(c.id)} uses={usage[c.id] ?? []} />
            ))}
          </div>
        </section>

        {weekly.length > 0 ? (
          <section className="card" aria-labelledby="syl-objectives">
            <h2 className="card-title" id="syl-objectives">주차 학습 목표</h2>
            <p className="card-sub">토론의 목표가 가리키는 항목입니다. 토론의 하위 논점이 어느 목표를 요구하는지는 교수가 설계 지도에서 판정합니다.</p>
            <div className="syl-items">
              {weekly.map((o) => (
                <ItemCard key={o.id} syl={syl} item={item(o.id)} uses={usage[o.id] ?? []} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="card" aria-labelledby="syl-eval">
          <h2 className="card-title" id="syl-eval">평가</h2>
          <div className="table-wrap">
            <table className="data">
              <caption className="visually-hidden">평가 항목과 반영 비율</caption>
              <thead>
                <tr>
                  <th scope="col">평가</th>
                  <th scope="col" className="num">비율</th>
                  <th scope="col">활동</th>
                </tr>
              </thead>
              <tbody>
                {syl.evaluation.map((e) => (
                  <tr key={e.name}>
                    <th scope="row">{e.name}</th>
                    <td className="num">{e.weight}%</td>
                    <td className="small">
                      {e.activityIds.map((id, i) => {
                        const a = activity(id);
                        return (
                          <span key={id}>
                            {i > 0 ? " · " : ""}
                            {a?.href ? <Link href={a.href}>{a.name}</Link> : <span title="데모에서는 열리지 않는 활동">{a?.name ?? id}</span>}
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
