import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/moodle/PageParts";
import { StatementBrowser } from "@/components/xapi/StatementBrowser";
import { getCourse, getDataset } from "@/lib/data";
import { statementsUrl } from "@/lib/xapi/load";
import { IRI_BASE, PLATFORM, VERB } from "@/lib/xapi/vocab";
// 빌드 때 만든 검증 보고서만 읽는다. 검증 라이브러리는 브라우저 번들에 넣지 않는다 (docs/xapi-plan.md §3.5)
import report from "../../../public/xapi/quiz-w5.validation.json";

export const metadata: Metadata = { title: "xAPI 기록" };

const verbName = new Map(Object.entries(VERB).map(([k, iri]) => [iri as string, k]));

export default function XapiPage() {
  const course = getCourse();
  const ds = getDataset("quiz-w5");
  if (!ds) notFound();
  const { quiz } = ds;
  const fileUrl = statementsUrl(quiz.id);
  const reportUrl = fileUrl.replace(".statements.json", ".validation.json");

  return (
    <div className="page">
      <PageHeader title="xAPI 기록" crumbs={[{ label: "My courses" }, { label: course.shortName, href: "/courses/" }, { label: "xAPI 기록" }]} />

      <div className="alert alert-info">
        <p>
          <strong>{quiz.name}</strong>의 응답 분석은 아래 Statement 파일에서 계산합니다. 분석 화면의 정답률·개념 오답률·학생 점수를 누르면 그 숫자를 만든
          Statement를 볼 수 있습니다.
        </p>
      </div>
      <div className="alert alert-warning">
        <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
          <li>모든 학생과 응답은 <strong>가상 데이터</strong>입니다. 모든 Statement에 <code>context.platform = &quot;{PLATFORM}&quot;</code>가 붙어 있습니다.</li>
          <li>IRI 도메인 <code>{IRI_BASE}</code>는 <strong>임시</strong>입니다. 데이터 풀에 넣기 전에 확정하고 다시 생성합니다.</li>
          <li>검증은 <strong>xAPI 1.0.3 기준</strong>입니다. 2.0 수용 여부는 인증 LRS 샌드박스 왕복 시연(P4)을 한 뒤에만 밝힙니다. 아직 하지 않았습니다.</li>
          <li>이 파일은 정적 파일입니다. LRS에 저장된 기록이 아닙니다.</li>
        </ul>
      </div>

      <div className="split">
        <section className="card" aria-labelledby="xv-title">
          <h2 className="card-title" id="xv-title">검증 보고서</h2>
          <dl className="grid-4" style={{ margin: "0.5rem 0 1rem" }}>
            <div className="stat-tile">
              <dt className="label">Statement</dt>
              <dd className="value" style={{ margin: 0 }}>{report.statementCount}건</dd>
            </div>
            <div className="stat-tile">
              <dt className="label">검증 문제</dt>
              <dd className="value" style={{ margin: 0 }}>{report.problemCount}건</dd>
            </div>
            <div className="stat-tile" style={{ gridColumn: "span 2" }}>
              <dt className="label">검증기 · 기준</dt>
              <dd className="value" style={{ margin: 0, fontSize: "var(--fs-lg)" }}><code>{report.validator}</code></dd>
              <dd className="detail" style={{ margin: 0 }}>{report.specBasis}</dd>
            </div>
          </dl>
          <table className="data">
            <caption className="visually-hidden">동사별 Statement 건수</caption>
            <thead><tr><th scope="col">동사</th><th scope="col">IRI</th><th scope="col" className="num">건수</th></tr></thead>
            <tbody>
              {Object.entries(report.byVerb).map(([iri, n]) => (
                <tr key={iri}>
                  <th scope="row">{verbName.get(iri) ?? iri}</th>
                  <td className="small"><code>{iri}</code></td>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: "0.5rem" }}>
            Statement 데이터 버전 <code>{report.statementDataVersion}</code>. 보고서는 Statement 파일을 생성할 때(<code>npm run gen:data</code>) 함께 만듭니다.
          </p>
        </section>

        <section className="card" aria-labelledby="xd-title">
          <h2 className="card-title" id="xd-title">파일 내려받기</h2>
          <ul className="stack">
            <li><a href={fileUrl} download>{quiz.id}.statements.json</a> <span className="small muted">— Statement {report.statementCount}건 (JSON 배열)</span></li>
            <li><a href={reportUrl} download>{quiz.id}.validation.json</a> <span className="small muted">— 검증 보고서</span></li>
          </ul>
          <p className="small">
            무응답 문항은 <code>answered</code> Statement가 없습니다. 미응시 학생은 Statement가 없고, 명단과 비교해 미응시로 계산합니다. 규칙은{" "}
            <code>docs/xapi-profile.md</code>에 있습니다.
          </p>
        </section>
      </div>

      <section className="card" style={{ marginTop: "1rem" }} aria-labelledby="xl-title">
        <h2 className="card-title" id="xl-title">Statement 목록</h2>
        <StatementBrowser
          quizId={quiz.id}
          courseId={quiz.courseId}
          items={quiz.items.map((it) => ({ id: it.id, number: it.number }))}
          students={ds.students.map((s) => ({ id: s.id, name: s.name }))}
        />
      </section>
    </div>
  );
}
