import Link from "next/link";
import { Icon } from "./Icon";

export function Navbar({ teacher }: { teacher: string }) {
  return (
    <header className="navbar">
      <Link href="/" className="navbar-brand" aria-label="LearnLens 소개">
        <span className="brand-mark" aria-hidden="true">LL</span>
        LearnLens
      </Link>
      <nav aria-label="주 메뉴">
        <ul className="primary-nav">
          <li><span className="nav-disabled" title="데모에서는 열리지 않음">Home</span></li>
          <li><span className="nav-disabled" title="데모에서는 열리지 않음">Dashboard</span></li>
          <li><Link href="/courses/" aria-current="page">My courses</Link></li>
        </ul>
      </nav>
      <div className="navbar-end">
        <span className="badge badge-demo">가상 데이터 데모</span>
        <button type="button" className="icon-btn" aria-label="알림 (데모에서는 동작하지 않음)" disabled>
          <Icon name="bell" />
        </button>
        <button type="button" className="icon-btn" aria-label="메시지 (데모에서는 동작하지 않음)" disabled>
          <Icon name="chat" />
        </button>
        <Link href="/settings/ai/" className="btn btn-sm btn-outline">AI 설정</Link>
        <span className="role-chip">교수 보기</span>
        <span className="avatar" title={`${teacher} (교수)`} aria-label={`${teacher} (교수)`}>
          {teacher.slice(0, 1)}
        </span>
      </div>
    </header>
  );
}
