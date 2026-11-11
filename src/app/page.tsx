import Link from "next/link";

const FEATURES = [
  {
    title: "어떤 개념에서 틀렸나",
    body: "퀴즈 응답을 개념별 관찰 오답률 Heatmap으로 모아 학급이 어디에서 막혔는지 한눈에 봅니다. 숫자를 누르면 근거가 된 xAPI Statement를 확인할 수 있습니다.",
  },
  {
    title: "어떤 문항 근거인가",
    body: "문항분석, 동시 오답 패턴, 문항 유사도 네트워크로 오답이 몰린 문항과 개념 태그(Q-matrix)를 점검하고 고칩니다.",
  },
  {
    title: "어떤 학생을 도울까",
    body: "개념별 규칙이나 오답이 비슷한 학생 묶음으로 보충 그룹을 제안합니다. 저장·보류·거부는 교수가 정하며, 근거가 부족하면 보류할 수 있습니다.",
  },
  {
    title: "서술형은 AI가 먼저 채점",
    body: "루브릭 기준마다 AI가 점수와 답안 속 근거를 제안합니다. 교수가 수락하거나 고치거나 직접 채점해 확정합니다.",
  },
];

const STEPS = [
  { title: "My courses에서 과정을 엽니다", body: "5주차 퀴즈와 5주차 서술형 퀴즈가 열립니다." },
  { title: "퀴즈의 ‘분석 보기’를 엽니다", body: "AI 요약 초안으로 큰 그림을 보고, Heatmap과 문항분석으로 근거를 확인합니다." },
  { title: "보충 그룹을 정합니다", body: "제안된 그룹을 저장하거나, 근거가 약하면 보류합니다." },
  { title: "서술형 ‘채점 화면’에서 확정합니다", body: "AI 제안을 검토해 점수를 확정하고, 분석 화면에서 학급 결과를 봅니다." },
];

export default function Intro() {
  return (
    <div className="intro">
      <header className="intro-top">
        <span className="navbar-brand">
          <span className="brand-mark" aria-hidden="true">LL</span>
          LearnLens
        </span>
        <span className="badge badge-demo">가상 데이터 데모</span>
      </header>

      <section className="intro-hero" aria-labelledby="intro-title">
        <h1 id="intro-title">한 차시 퀴즈, 어디서 막혔는지 근거와 함께 봅니다</h1>
        <p className="intro-lead">
          LearnLens는 교수가 퀴즈 결과에서 <strong>어떤 개념</strong>에서, <strong>어떤 문항 근거</strong>로, <strong>어떤 학생</strong>이 틀렸는지 확인하고
          보충 지도를 결정하도록 돕는 분석 도구의 데모입니다.
        </p>
        <Link className="btn btn-primary intro-cta" href="/courses/">시작해보기</Link>
      </section>

      <section className="intro-section" aria-labelledby="intro-features">
        <h2 id="intro-features">이런 일을 합니다</h2>
        <ul className="intro-grid">
          {FEATURES.map((f) => (
            <li key={f.title} className="card">
              <h3 className="card-title">{f.title}</h3>
              <p className="muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="intro-section" aria-labelledby="intro-steps">
        <h2 id="intro-steps">이렇게 써 보세요</h2>
        <ol className="intro-steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <span className="muted">{s.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="intro-section" aria-labelledby="intro-notes">
        <h2 id="intro-notes">알아 두세요</h2>
        <ul className="intro-notes">
          <li>모든 데이터는 <strong>가상</strong>이며, Moodle 5.3 화면을 참고한 비공식 데모입니다.</li>
          <li>오답률은 <strong>관찰된 비율</strong>이지 개념 숙달 여부가 아닙니다. 학생 수가 적어 값이 크게 흔들릴 수 있습니다.</li>
          <li>AI는 초안만 제안합니다. 요약과 채점은 교수가 확정해야 반영됩니다.</li>
          <li>결정과 편집 내용은 이 브라우저에만 저장됩니다.</li>
        </ul>
        <Link className="btn btn-primary intro-cta" href="/courses/">시작해보기</Link>
      </section>
    </div>
  );
}
