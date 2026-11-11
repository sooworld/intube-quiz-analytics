// Statement 파일을 브라우저에서 필요할 때 한 번만 받는다. 클라이언트 번들에는 넣지 않는다 (docs/xapi-plan.md §3.1).
import type { XStatement } from "./vocab";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** public/xapi/의 Statement 파일 주소. 같은 주소가 원자료 내려받기 링크다 */
export const statementsUrl = (quizId: string) => `${BASE}/xapi/${quizId}.statements.json`;

const cache = new Map<string, Promise<XStatement[]>>();
const loaded = new Map<string, XStatement[]>();

/** 이미 받은 파일 (없으면 undefined). 한 번 받은 뒤에는 다른 숫자의 근거를 바로 보여 줄 때 쓴다 */
export const loadedStatements = (quizId: string) => loaded.get(quizId);

export function loadStatements(quizId: string): Promise<XStatement[]> {
  let p = cache.get(quizId);
  if (!p) {
    p = fetch(statementsUrl(quizId)).then(async (r) => {
      if (!r.ok) throw new Error(`Statement 파일을 받지 못했습니다 (HTTP ${r.status})`);
      const ss = (await r.json()) as XStatement[];
      loaded.set(quizId, ss);
      return ss;
    });
    // 실패하면 다시 시도할 수 있게 캐시에서 뺀다
    p.catch(() => cache.delete(quizId));
    cache.set(quizId, p);
  }
  return p;
}
