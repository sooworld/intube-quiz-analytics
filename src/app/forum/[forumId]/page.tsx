import Link from "next/link";
import { notFound } from "next/navigation";
import { InfoTip } from "@/components/moodle/InfoTip";
import { getForum } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { FORUM_KIND_LABEL, type ForumDataset, type ForumPost } from "@/lib/forum/types";

export async function generateMetadata({ params }: { params: Promise<{ forumId: string }> }) {
  const { forumId } = await params;
  return { title: getForum(forumId)?.forum.name ?? "토론" };
}

function Post({ p, ds }: { p: ForumPost; ds: ForumDataset }) {
  const kids = ds.posts.filter((x) => x.parentId === p.id);
  return (
    <article className="fp" aria-labelledby={`fp-${p.id}`}>
      <div className="fp-head">
        <span className="avatar" aria-hidden="true">{p.author.slice(0, 1)}</span>
        <strong id={`fp-${p.id}`}>{p.author}</strong>
        <span>{formatDateTime(p.createdAt)}</span>
      </div>
      <div className="fp-body">{p.text}</div>
      <div className="fp-foot">
        <Link href={`/forum/${ds.forum.id}/posts/#post-${p.id}`}>글별 근거 보기</Link>
      </div>
      {kids.length > 0 ? (
        <div className="fp-children">
          {kids.map((k) => (
            <Post key={k.id} p={k} ds={ds} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default async function ForumThreadPage({ params }: { params: Promise<{ forumId: string }> }) {
  const { forumId } = await params;
  const ds = getForum(forumId);
  if (!ds) notFound();
  const roots = ds.posts.filter((p) => p.parentId === null);
  const authors = new Set(ds.posts.map((p) => p.author)).size;
  return (
    <>
      <dl className="grid-4" style={{ margin: "0 0 1rem" }}>
        <div className="stat-tile"><dt className="label">유형</dt><dd className="value" style={{ fontSize: "var(--fs-lg)", margin: 0 }}>{FORUM_KIND_LABEL[ds.forum.kind]}</dd></div>
        <div className="stat-tile"><dt className="label">글</dt><dd className="value" style={{ margin: 0 }}>{ds.posts.length}개</dd><dd className="detail" style={{ margin: 0 }}>답글 {ds.posts.length - roots.length}개</dd></div>
        <div className="stat-tile"><dt className="label">작성자</dt><dd className="value" style={{ margin: 0 }}>{authors}명</dd></div>
        <div className="stat-tile"><dt className="label">마감</dt><dd className="value" style={{ fontSize: "var(--fs-lg)", margin: 0 }}>{formatDateTime(ds.forum.closesAt)}</dd></div>
      </dl>

      <article className="fp fp-opening" aria-labelledby="fp-opening">
        <div className="fp-head">
          <span className="avatar" aria-hidden="true">교</span>
          <strong id="fp-opening">{ds.forum.topic}</strong>
          <span>{formatDateTime(ds.forum.opensAt)}</span>
        </div>
        <p className="fp-body" style={{ margin: 0 }}>{ds.forum.intro}</p>
        {ds.work ? (
          <figure style={{ margin: "0.75rem 0 0" }}>
            <figcaption className="small"><strong>「{ds.work.title}」</strong> {ds.work.author} · {ds.work.source}</figcaption>
            <div className="poem">
              {ds.work.stanzas.map((s, i) => (
                <p key={i}>
                  {s.map((line, j) => (
                    <span key={j}>
                      {line}
                      {j < s.length - 1 ? <br /> : null}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </figure>
        ) : null}
        <h2 className="card-title" style={{ marginTop: "0.75rem" }}>
          하위 질문
          <InfoTip label="하위 질문">
            <span>교수가 토론 주제를 나눈 하위 논점입니다. 중요도와 정리 시간 예정 비중은 교수 메모이며, 글 수의 기대 비율이 아닙니다.</span>
          </InfoTip>
        </h2>
        <ol className="q-list">
          {ds.subQuestions.map((q) => (
            <li key={q.id}>
              <strong>{q.id}</strong> {q.text} <span className="small muted">(중요도 {q.importance} · 정리 시간 예정 {Math.round(q.plannedShare * 100)}%)</span>
            </li>
          ))}
        </ol>
      </article>

      <h2 className="visually-hidden">답글</h2>
      <div style={{ marginTop: "0.75rem" }}>
        {roots.map((p) => (
          <Post key={p.id} p={p} ds={ds} />
        ))}
      </div>
    </>
  );
}
