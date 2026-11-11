import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>요청한 주소가 이 데모에 없습니다.</p>
      <Link className="btn btn-primary" href="/courses/">과정 홈으로</Link>
    </div>
  );
}
