// 규칙 기반 모의 채점(AI 아님). 키 없이 전체 흐름을 시연하고 테스트하기 위한 것이다.
// 일부러 생성기 문장 뱅크(scripts/generate-essays.ts)를 참조하지 않고 개념 핵심어로만 판단한다.
// 그래서 완벽하지 않으며, 보류 답안에서 틀리는 것이 정상이다.
import type { RubricLevel } from "../../types";

export interface MockJudgement {
  level: RubricLevel;
  /** 근거로 쓸 문장을 고를 때 쓰는 패턴 */
  evidence: RegExp | null;
}

type Rule = (text: string) => MockJudgement;

const any = (text: string, ...res: RegExp[]) => res.some((r) => r.test(text));
const sentencesOf = (text: string) => text.split(/(?<=[.!?。])\s+/).filter((s) => s !== "");
/** 두 알고리즘을 직접 거론한 문장에서만 차이를 센다 (다른 기준의 문장이 끼어드는 것을 줄인다) */
const namedFacts = (text: string, facts: RegExp[]) => {
  const named = sentencesOf(text).filter((s) => /(BFS|다익스트라|두 방법)/i.test(s));
  return facts.filter((f) => named.some((s) => f.test(s))).length;
};

export const MOCK_RULES: Record<string, Rule> = {
  "e1-fix": (t) => {
    const concrete = any(t, /(정렬|sort).{0,30}(인접|이웃|비교)/i, /(해시|set|집합).{0,40}(저장|넣|확인|이미)/i);
    if (concrete) return { level: 2, evidence: /(정렬|sort|해시|set|집합)/i };
    if (any(t, /(print|사양을 올|입력을 (막|제한)|작은 입력만)/i)) return { level: 0, evidence: /(print|사양|제한|작은 입력만)/i };
    if (any(t, /(정렬|해시|set|자료구조|루프를 (중첩하지|줄))/i)) return { level: 1, evidence: /(정렬|해시|set|자료구조|루프)/i };
    return { level: 0, evidence: null };
  },
  "e1-bigo": (t) => {
    const quadratic = any(t, /O\(n²\)|O\(n\^2\)|n제곱/);
    if (!quadratic && /O\((n|log n)\)/.test(t)) return { level: 0, evidence: /O\((n|log n)\)/ };
    const reason = any(t, /(이중|중첩|n\(n.?1\)\s*\/\s*2|모든 쌍|100배|n²에 비례)/);
    const improved = any(t, /(O\(n log n\)|평균 O\(n\)|O\(n\) 평균)/);
    if (quadratic && reason && improved) return { level: 2, evidence: /(O\(n²\)|n\(n.?1\)|n²에 비례)/ };
    if (quadratic || /시간복잡도/.test(t)) return { level: 1, evidence: /(O\(n²\)|시간복잡도)/ };
    return { level: 0, evidence: null };
  },
  "e1-tradeoff": (t) => {
    if (any(t, /(단점이 없|항상 더 좋|고려할 점은 없|단점은 없)/)) return { level: 0, evidence: /(단점이 없|항상 더 좋|고려할 점은 없|단점은 없)/ };
    const facts = [
      /(메모리|공간).{0,20}(O\(n\)|더 쓰|늘|필요)/,
      /(충돌|최악의 경우)/,
      /(원본 ?(순서)?.{0,6}(바꾸|변경|건드리)|복사)/,
      /(입력 크기|메모리 제한|상황에 맞춰)/,
    ].filter((r) => r.test(t)).length;
    if (facts >= 2) return { level: 2, evidence: /(메모리|공간|충돌|원본|복사)/ };
    if (facts >= 1 || /(단점|완벽|상황에 따라|한계|메모리|공간)/.test(t)) return { level: 1, evidence: /(단점|완벽|상황에 따라|한계|메모리|공간|충돌)/ };
    return { level: 0, evidence: null };
  },
  "e2-algo": (t) => {
    if (any(t, /다익스트라도.{0,20}큐 하나/, /BFS는 가중치가 (달라도|있어도) 항상/i)) return { level: 0, evidence: /(다익스트라도|항상 최단)/ };
    const facts = namedFacts(t, [
      /(간선 (수|개수)|가중치를 (보지|무시))/,
      /(우선순위 큐|최소 힙)/,
      /(누적|가중치 합|가중치가 있는|가중치를 (고려|반영|쓰))/,
      /음수/,
      /탐욕/,
    ]);
    if (facts >= 2) return { level: 2, evidence: /(BFS|다익스트라)/i };
    if (facts >= 1) return { level: 1, evidence: /(BFS|다익스트라)/i };
    return { level: 0, evidence: null };
  },
  "e2-struct": (t) => {
    if (any(t, /음수 가중치.{0,15}(항상|상관없|문제없)/, /모든 경로를 (직접 )?나열/)) return { level: 0, evidence: /(음수 가중치|나열)/ };
    const facts = [
      /(우선순위 큐|최소 힙|heapq)/i,
      /O\(\(V ?\+ ?E\) ?log ?V\)/i,
      /(음수|양수)/,
      /인접 리스트/,
    ].filter((r) => r.test(t)).length;
    if (facts >= 3) return { level: 2, evidence: /(우선순위 큐|최소 힙|heapq|O\(\(V)/i };
    if (facts >= 1) return { level: 1, evidence: /(우선순위 큐|최소 힙|heapq|O\(\(V|인접 리스트|음수|양수)/i };
    return { level: 0, evidence: null };
  },
  "e2-link": (t) => {
    if (any(t, /가중치가 서로 다를수록 BFS가 더 낫/i, /어느 쪽이든 상관없/)) return { level: 0, evidence: /(더 낫|상관없)/ };
    const chose = any(t, /(다익스트라|BFS).{0,20}(선택|쓰겠|쓸|사용|적합|나을|낫|맞다)/i, /(선택|쓰겠|사용하겠).{0,4}$/m);
    if (!chose) return { level: 0, evidence: null };
    const tied = any(t, /(통행 시간|가중치|양수|희소|음수|구간).{0,60}(다익스트라|적합|선택|쓰겠)/);
    if (tied) return { level: 2, evidence: /(통행 시간|가중치|양수|희소|음수|구간)/ };
    return { level: 1, evidence: /(다익스트라|BFS)/i };
  },
};
