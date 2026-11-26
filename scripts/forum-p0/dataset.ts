// P0 실패 탐색용 합성 자료 (docs/forum-claim-map.md 부록 B · S3).
// 설계자가 쓴 글이므로 "실패를 찾는 데"만 쓴다. 성능 입증이나 통과율 일반화에 쓰지 않는다.
// 라벨은 설계자의 판단이다. 학생 글·실제 강의 자료가 아니다.

export type LectureUnit = { id: string; week: number; text: string };

/**
 * 강의 내용에 비춘 관계.
 * conditional = 주장은 참이지만, 근거 문단에 반대 조건의 문장도 함께 있어 판정 단계가 모순으로 오판할 위험이 있는 것(반례 e).
 * mixed = 한 글에 참인 주장과 틀린 주장이 섞임.
 */
export type Relation = "consistent" | "contradicts" | "conditional" | "mixed" | "not-covered" | "off-topic" | "no-claim";
/** 원글에 대한 태도. copy = 원글을 거의 그대로 옮김. */
export type Stance = "agree" | "oppose" | "neutral" | "copy";
/**
 * a-wrong/a-right: 단어를 거의 같게 두고 참·거짓만 바꾼 쌍 (반례 a)
 * b: 원글 T1에 대한 찬반 (반례 b) · c: 틀린 원글 T2 (반례 c) · d: 동의어·영문 표기 (반례 d)
 * e: 조건부 참 (반례 e) · f: 기술 용어 없이 바꿔 말함 또는 강의에 없는 내용 (반례 f)
 * g: 용어 나열·강의 문장 복사 (게이밍) · h: 대조군 (잡담, 아주 짧은 답글, 평범한 맞는 글)
 * i: 복합 (오개념을 인용한 뒤 반박, 참·거짓 섞임, 앞 답글을 가리키는 대명사)
 */
export type Category = "a-wrong" | "a-right" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i";

export type Claim = {
  id: string;
  thread: "T1" | "T2";
  text: string;
  category: Category;
  /** 판정할 때 교수가 펼쳐 볼 강의 문단 id (주장 전체를 증명하는 문단이라는 뜻은 아님). 강의에 없거나 주장이 없으면 빈 배열. */
  gold: string[];
  relation: Relation;
  stance: Stance;
  /** a 범주에서 짝이 되는 글 id */
  pair?: string;
};

/** 5주차 "강의 자료: 그래프 탐색과 최단 경로" (L*) + 다른 주차 방해 문단 (D*). */
export const LECTURE: LectureUnit[] = [
  { id: "L1", week: 5, text: "그래프는 정점과 간선으로 이루어진다. 인접 리스트는 정점마다 이웃 목록을 저장해 간선이 적은 희소 그래프에서 메모리를 아낀다. 인접 행렬은 두 정점의 연결 여부를 상수 시간에 확인하지만 정점 수의 제곱만큼 공간이 든다." },
  { id: "L2", week: 5, text: "너비 우선 탐색은 시작 정점에서 가까운 정점부터 차례로 방문한다. 방문할 정점을 큐에 넣고 먼저 들어온 것부터 꺼낸다. 간선마다 비용이 같은 그래프에서는 처음 도달한 순간의 간선 수가 최단 거리다." },
  { id: "L3", week: 5, text: "깊이 우선 탐색은 한 경로를 끝까지 따라간 뒤 되돌아온다. 스택이나 재귀 호출로 구현한다. 연결 요소 찾기, 사이클 검사, 위상 정렬에 쓰인다. 처음 찾은 경로가 최단 경로라는 보장은 없다." },
  { id: "L4", week: 5, text: "탐색 중 이미 방문한 정점을 기록하지 않으면 사이클이 있는 그래프에서 같은 정점을 끝없이 다시 넣게 된다. 방문 집합을 두면 각 정점과 간선을 한 번씩만 처리해 탐색 시간이 O(V+E)가 된다." },
  { id: "L5", week: 5, text: "다익스트라 알고리즘은 가중치가 음수가 아닌 그래프에서 한 정점으로부터 모든 정점까지의 최단 거리를 구한다. 아직 확정되지 않은 정점 중 거리가 가장 짧은 정점을 골라 확정하고, 그 정점에서 나가는 간선으로 이웃의 거리를 갱신한다." },
  { id: "L6", week: 5, text: "가장 짧은 거리의 정점을 고를 때 우선순위 큐인 이진 힙을 쓰면 전체 시간은 O((V+E) log V)다. 배열에서 매번 최솟값을 찾으면 O(V²)이며, 간선이 매우 많은 밀집 그래프에서는 오히려 이 방법이 단순하다." },
  { id: "L7", week: 5, text: "간선 가중치에 음수가 있으면 다익스트라 알고리즘은 틀린 답을 낼 수 있다. 한 번 확정한 거리가 나중에 음수 간선을 거쳐 더 짧아질 수 있기 때문이다. 이때는 벨만-포드 알고리즘을 쓰며, 이 알고리즘은 음수 사이클도 찾아낸다." },
  { id: "L8", week: 5, text: "모든 간선의 비용이 같다면 다익스트라 대신 너비 우선 탐색으로 충분하고 더 빠르다. 도로망처럼 간선마다 비용이 다른 그래프에서 너비 우선 탐색은 간선 수가 적은 경로를 고를 뿐 비용이 가장 작은 경로를 보장하지 않는다." },
  { id: "L9", week: 5, text: "최단 거리뿐 아니라 경로 자체가 필요하면 거리를 갱신할 때마다 직전 정점을 기록한다. 도착 정점에서 직전 정점을 거꾸로 따라가면 경로가 복원된다." },
  { id: "L10", week: 5, text: "모든 정점 쌍 사이의 최단 거리가 필요하면 플로이드-워셜 알고리즘을 쓴다. 세 겹의 반복문으로 경유 정점을 하나씩 늘려 가며 O(V³) 시간에 계산한다." },
  { id: "D1", week: 3, text: "병합 정렬은 배열을 반으로 나눠 각각 정렬한 뒤 합치며 항상 O(n log n) 시간이 든다. 같은 값의 원래 순서를 유지하는 안정 정렬이다." },
  { id: "D2", week: 3, text: "퀵 정렬은 피벗을 기준으로 배열을 분할한다. 평균 시간은 O(n log n)이지만 피벗이 계속 한쪽 끝으로 잡히면 O(n²)이 된다." },
  { id: "D3", week: 6, text: "해시 테이블은 키를 해시 함수로 버킷에 대응시켜 평균 상수 시간에 찾는다. 충돌이 한 버킷에 몰리면 최악의 경우 O(n)이 된다." },
  { id: "D4", week: 6, text: "이진 힙은 완전 이진 트리로 최솟값을 상수 시간에 확인하고 삽입과 삭제는 O(log n)에 한다. 우선순위 큐를 구현할 때 가장 흔히 쓴다." },
];

/** 원글. T1은 강의와 맞고, T2는 틀렸다 (반례 c). */
export const POSTS = {
  T1: { text: "도로 지도에서 최단 경로를 찾을 때는 다익스트라를 써야 한다고 생각합니다. 도로마다 길이가 달라서 너비 우선 탐색은 간선 수만 따지고 실제로 가장 짧은 길을 못 찾을 수 있기 때문입니다.", relation: "consistent" as Relation, gold: ["L8"] },
  T2: { text: "다익스트라는 어떤 그래프에서든 최단 경로를 구해 주니까, 음수 가중치가 있는 환율 그래프에도 그대로 쓰면 된다고 봅니다.", relation: "contradicts" as Relation, gold: ["L7"] },
} as const;

export const CLAIMS: Claim[] = [
  // a. 오개념: 강의 문장과 단어가 같고 참·거짓만 다르다
  { id: "a1w", thread: "T2", category: "a-wrong", pair: "a1r", gold: ["L7"], relation: "contradicts", stance: "agree", text: "맞습니다. 다익스트라는 음수 가중치가 있어도 최단 거리를 정확히 구합니다." },
  { id: "a1r", thread: "T2", category: "a-right", pair: "a1w", gold: ["L7"], relation: "consistent", stance: "oppose", text: "아닙니다. 다익스트라는 음수 가중치가 있으면 최단 거리를 틀리게 구할 수 있습니다." },
  { id: "a2w", thread: "T1", category: "a-wrong", pair: "a2r", gold: ["L8"], relation: "contradicts", stance: "oppose", text: "너비 우선 탐색은 길이가 서로 다른 도로망에서도 비용이 가장 작은 경로를 보장합니다." },
  { id: "a2r", thread: "T1", category: "a-right", pair: "a2w", gold: ["L8"], relation: "consistent", stance: "agree", text: "너비 우선 탐색은 길이가 서로 다른 도로망에서는 비용이 가장 작은 경로를 보장하지 않습니다." },
  { id: "a3w", thread: "T1", category: "a-wrong", pair: "a3r", gold: ["L6"], relation: "contradicts", stance: "neutral", text: "다익스트라에 우선순위 큐를 쓰면 시간복잡도가 O(V²)로 늘어납니다." },
  { id: "a3r", thread: "T1", category: "a-right", pair: "a3w", gold: ["L6"], relation: "consistent", stance: "neutral", text: "다익스트라에 우선순위 큐를 쓰면 시간복잡도가 O((V+E) log V)로 줄어듭니다." },
  { id: "a4w", thread: "T1", category: "a-wrong", pair: "a4r", gold: ["L4"], relation: "contradicts", stance: "neutral", text: "방문 집합을 두지 않아도 사이클이 있는 그래프의 탐색은 항상 끝납니다." },
  { id: "a4r", thread: "T1", category: "a-right", pair: "a4w", gold: ["L4"], relation: "consistent", stance: "neutral", text: "방문 집합을 두지 않으면 사이클이 있는 그래프의 탐색이 끝나지 않을 수 있습니다." },
  { id: "a5w", thread: "T1", category: "a-wrong", pair: "a5r", gold: ["L3"], relation: "contradicts", stance: "neutral", text: "깊이 우선 탐색이 처음 찾은 경로는 항상 최단 경로입니다." },
  { id: "a5r", thread: "T1", category: "a-right", pair: "a5w", gold: ["L3"], relation: "consistent", stance: "neutral", text: "깊이 우선 탐색이 처음 찾은 경로가 최단 경로라는 보장은 없습니다." },
  { id: "a6w", thread: "T2", category: "a-wrong", pair: "a6r", gold: ["L7"], relation: "contradicts", stance: "neutral", text: "벨만-포드도 음수 사이클은 찾지 못하니 다익스트라와 다를 게 없습니다." },
  { id: "a6r", thread: "T2", category: "a-right", pair: "a6w", gold: ["L7"], relation: "consistent", stance: "neutral", text: "벨만-포드는 음수 사이클도 찾아내므로 다익스트라와 쓰임이 다릅니다." },

  // b. 찬반: 원글(T1)과 가까운지는 찬성·반대를 말해 주지 않는다
  { id: "b1", thread: "T1", category: "b", gold: ["L8"], relation: "consistent", stance: "copy", text: "도로 지도에서 최단 경로를 찾을 때는 다익스트라를 써야 합니다. 도로마다 길이가 달라서 너비 우선 탐색은 가장 짧은 길을 못 찾을 수 있어요." },
  { id: "b2", thread: "T1", category: "b", gold: ["L8"], relation: "contradicts", stance: "oppose", text: "도로 지도라고 다익스트라를 써야 하는 건 아닙니다. 도로 길이가 달라도 너비 우선 탐색이 가장 짧은 길을 찾아 줍니다." },
  { id: "b3", thread: "T1", category: "b", gold: ["L5", "L8"], relation: "consistent", stance: "agree", text: "가중치가 제각각이면 거리가 가장 짧은 곳부터 하나씩 확정해 나가야 하니 원글 의견에 동의합니다." },
  { id: "b4", thread: "T1", category: "b", gold: ["L9"], relation: "consistent", stance: "neutral", text: "도로 지도라면 길을 안내해야 하니 각 정점에 직전 정점을 기록해 두어야겠네요." },

  // c. 틀린 원글(T2): 원글에 가까울수록 좋은 글이라는 해석이 깨진다
  { id: "c1", thread: "T2", category: "c", gold: ["L7"], relation: "contradicts", stance: "agree", text: "네, 환율 그래프처럼 음수 가중치가 있어도 다익스트라를 그대로 쓰면 됩니다." },
  { id: "c2", thread: "T2", category: "c", gold: ["L7"], relation: "consistent", stance: "oppose", text: "음수 가중치가 있는 환율 그래프에는 벨만-포드를 써야 합니다. 다익스트라는 한 번 확정한 거리가 나중에 더 짧아질 수 있어서요." },

  // d. 동의어·영문 표기: 강의는 한국어 용어만 쓴다
  { id: "d1", thread: "T1", category: "d", gold: ["L2", "L8"], relation: "consistent", stance: "neutral", text: "BFS는 모든 edge 비용이 같을 때만 최단 경로를 보장합니다." },
  { id: "d2", thread: "T1", category: "d", gold: ["L3"], relation: "consistent", stance: "neutral", text: "DFS는 stack이나 재귀로 구현하고 cycle 검사에 씁니다." },
  { id: "d3", thread: "T2", category: "d", gold: ["L7"], relation: "consistent", stance: "oppose", text: "Dijkstra는 negative weight가 있으면 쓰면 안 됩니다." },
  { id: "d4", thread: "T1", category: "d", gold: ["L6"], relation: "consistent", stance: "neutral", text: "Dijkstra에서 다음 노드는 min-heap에서 꺼내면 빠릅니다." },
  { id: "d5", thread: "T1", category: "d", gold: ["L4"], relation: "consistent", stance: "neutral", text: "visited 체크를 빼먹으면 cycle이 있는 그래프에서 무한 루프에 빠질 수 있습니다." },
  { id: "d6", thread: "T1", category: "d", gold: ["L9"], relation: "consistent", stance: "neutral", text: "길을 되짚으려면 노드마다 이전 노드를 저장해 둡니다." },

  // e. 조건부 참: 검색된 문단에 반대 조건도 함께 있다 (판정 단계 위험, P0에서는 검색만 본다)
  { id: "e1", thread: "T1", category: "e", gold: ["L8"], relation: "conditional", stance: "neutral", text: "모든 도로의 길이가 같다면 너비 우선 탐색으로 충분하고 오히려 더 빠릅니다." },
  { id: "e2", thread: "T1", category: "e", gold: ["L6"], relation: "conditional", stance: "neutral", text: "간선이 아주 많은 밀집 그래프라면 힙 없이 배열에서 최솟값을 찾는 편이 더 단순합니다." },
  { id: "e3", thread: "T2", category: "e", gold: ["L7"], relation: "conditional", stance: "oppose", text: "음수 간선이 있어도 음수 사이클만 없다면 벨만-포드로 최단 거리를 구할 수 있습니다." },

  // f. 검색 누락: 기술 용어 없이 바꿔 말한 글(f1~f3)과 강의에 없는 내용(f4, f5)
  { id: "f1", thread: "T1", category: "f", gold: ["L2"], relation: "consistent", stance: "neutral", text: "지하철에서 정거장 수가 가장 적은 길은 출발역에서 한 정거장, 두 정거장 떨어진 역 순서로 넓혀 가며 찾으면 됩니다." },
  { id: "f2", thread: "T1", category: "f", gold: ["L4"], relation: "consistent", stance: "neutral", text: "이미 들른 곳을 표시해 두면 같은 곳을 두 번 보지 않아서, 걸리는 시간이 점과 선의 개수에 비례합니다." },
  { id: "f3", thread: "T2", category: "f", gold: ["L7"], relation: "consistent", stance: "oppose", text: "한 번 정한 가장 짧은 값을 다시 고치지 않는 방식이라, 마이너스 값인 길이 섞이면 결과가 틀어집니다." },
  { id: "f4", thread: "T1", category: "f", gold: [], relation: "not-covered", stance: "neutral", text: "A* 알고리즘은 목적지까지 남은 거리를 어림해서 다익스트라보다 빨리 찾을 수 있습니다." },
  { id: "f5", thread: "T1", category: "f", gold: [], relation: "not-covered", stance: "neutral", text: "그래프 색칠 문제는 NP-완전이라서 큰 그래프에서는 근사 알고리즘을 씁니다." },

  // g. 게이밍: 주장 없이 용어를 늘어놓거나 강의 문장을 그대로 옮김
  { id: "g1", thread: "T1", category: "g", gold: [], relation: "no-claim", stance: "neutral", text: "다익스트라, 너비 우선 탐색, 깊이 우선 탐색, 우선순위 큐, 방문 집합, 벨만-포드, 최단 경로, O(V+E)." },
  { id: "g2", thread: "T1", category: "g", gold: ["L5"], relation: "consistent", stance: "neutral", text: "다익스트라 알고리즘은 가중치가 음수가 아닌 그래프에서 한 정점으로부터 모든 정점까지의 최단 거리를 구한다." },

  // h. 대조군
  { id: "h1", thread: "T1", category: "h", gold: [], relation: "off-topic", stance: "neutral", text: "이번 주 과제 마감이 언제인지 아시는 분 있나요?" },
  { id: "h2", thread: "T1", category: "h", gold: [], relation: "no-claim", stance: "agree", text: "동의합니다." },
  { id: "h3", thread: "T1", category: "h", gold: ["L9"], relation: "consistent", stance: "neutral", text: "경로를 출력하려면 거리를 고칠 때마다 어느 정점에서 왔는지 남겨 두어야 합니다." },

  // i. 복합 (Codex 리뷰 12): 주장 추출·맥락 없이는 거리로 다룰 수 없는 글
  { id: "i1", thread: "T2", category: "i", gold: ["L7"], relation: "consistent", stance: "oppose", text: "'다익스트라는 음수 가중치에서도 된다'는 말을 저도 들었는데, 강의를 다시 보니 틀린 말이었습니다. 확정한 거리가 나중에 바뀔 수 있기 때문입니다." },
  { id: "i2", thread: "T1", category: "i", gold: ["L2", "L7"], relation: "mixed", stance: "neutral", text: "너비 우선 탐색은 큐를 쓰고, 다익스트라는 음수 가중치가 있어도 정확합니다." },
  { id: "i3", thread: "T1", category: "i", gold: [], relation: "no-claim", stance: "agree", text: "위 답글 말이 맞아요. 그건 항상 그렇습니다." },
];

/** 반례 d 분리 측정: d 글의 영문·별칭 용어만 강의 용어로 바꾼 쌍둥이. 내용·길이·근거는 같다. */
export const D_TWINS: Record<string, string> = {
  d1: "너비 우선 탐색은 모든 간선 비용이 같을 때만 최단 경로를 보장합니다.",
  d2: "깊이 우선 탐색은 스택이나 재귀로 구현하고 사이클 검사에 씁니다.",
  d3: "다익스트라는 음수 가중치가 있으면 쓰면 안 됩니다.",
  d4: "다익스트라에서 다음 정점은 이진 힙에서 꺼내면 빠릅니다.",
  d5: "방문 체크를 빼먹으면 사이클이 있는 그래프에서 무한 루프에 빠질 수 있습니다.",
  d6: "길을 되짚으려면 정점마다 직전 정점을 저장해 둡니다.",
};

/** 길이 민감도: 같은 주장 앞에 주제와 무관한 사연을 붙인다. */
export const LENGTH_PAD = "저도 지난주 실습에서 이 부분이 헷갈려서 강의 자료를 다시 읽고 친구들과 한참 이야기해 봤는데요, 제가 정리한 결론은 이렇습니다. ";
export const LENGTH_IDS = ["a1w", "a2r", "d1", "f1"] as const;

/**
 * 과정 용어집(별칭). 용어 번역만 담고 바꿔 말하기("점과 선" 등)는 담지 않는다.
 * 같은 설계자가 시험 자료를 보고 만들었으므로 이 변형의 결과는 낙관적 상한으로만 읽는다.
 */
export const GLOSSARY: [RegExp, string][] = [
  [/\bbfs\b/i, "너비 우선 탐색"],
  [/\bdfs\b/i, "깊이 우선 탐색"],
  [/dijkstra/i, "다익스트라"],
  [/bellman[- ]?ford/i, "벨만-포드"],
  [/min-heap|\bheap\b|힙/i, "이진 힙 우선순위 큐"],
  [/\bstack\b/i, "스택"],
  [/\bqueue\b/i, "큐"],
  [/\bcycle\b/i, "사이클"],
  [/\bvisited\b/i, "방문"],
  [/\bedge\b/i, "간선"],
  [/\bnegative\b/i, "음수"],
  [/\bweight\b/i, "가중치"],
  [/노드/, "정점"],
];

/** 문단을 문장 단위로 나눈다 (분할 민감도용). id는 "L2.1"처럼 붙인다. */
export function toSentences(units: LectureUnit[]): (LectureUnit & { parent: string })[] {
  return units.flatMap((u) =>
    u.text
      .split(/(?<=[.?!])\s+/)
      .filter((s) => s.trim() !== "")
      .map((s, i) => ({ id: `${u.id}.${i + 1}`, week: u.week, text: s, parent: u.id })),
  );
}
