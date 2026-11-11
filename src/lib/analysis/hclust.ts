// 평균 연결(average linkage) 병합형 계층 군집. 탐색용이며 "실제 집단이 존재한다"는 증거가 아니다.
// 동률 처리: 거리가 같으면 (두 군집의 최소 잎 번호 쌍)이 사전순으로 앞선 쌍을 먼저 합친다.

export interface Merge {
  /** 새 군집 id (n, n+1, ...) */
  id: number;
  left: number;
  right: number;
  height: number;
  size: number;
}

export interface HClustResult {
  n: number;
  merges: Merge[];
  /** 덴드로그램 잎 순서 (원래 인덱스) */
  order: number[];
}

export function hclustAverage(dist: number[][]): HClustResult {
  const n = dist.length;
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) members.set(i, [i]);
  const merges: Merge[] = [];
  let nextId = n;
  const EPS = 1e-12;

  const avg = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += dist[i]![j]!;
    return s / (a.length * b.length);
  };

  while (members.size > 1) {
    const ids = [...members.keys()];
    let best: { a: number; b: number; d: number; ka: number; kb: number } | null = null;
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const ma = members.get(ids[x]!)!;
        const mb = members.get(ids[y]!)!;
        const d = avg(ma, mb);
        let ka = Math.min(...ma);
        let kb = Math.min(...mb);
        let a = ids[x]!;
        let b = ids[y]!;
        if (ka > kb) {
          [ka, kb] = [kb, ka];
          [a, b] = [b, a];
        }
        const better =
          !best ||
          d < best.d - EPS ||
          (Math.abs(d - best.d) <= EPS && (ka < best.ka || (ka === best.ka && kb < best.kb)));
        if (better) best = { a, b, d, ka, kb };
      }
    }
    const { a, b, d } = best!;
    const merged = [...members.get(a)!, ...members.get(b)!];
    members.delete(a);
    members.delete(b);
    members.set(nextId, merged);
    merges.push({ id: nextId, left: a, right: b, height: d, size: merged.length });
    nextId++;
  }

  return { n, merges, order: leafOrder(n, merges) };
}

function leafOrder(n: number, merges: Merge[]): number[] {
  if (n === 0) return [];
  if (merges.length === 0) return [0];
  const byId = new Map(merges.map((mg) => [mg.id, mg]));
  const out: number[] = [];
  const walk = (id: number) => {
    if (id < n) {
      out.push(id);
      return;
    }
    const mg = byId.get(id)!;
    walk(mg.left);
    walk(mg.right);
  };
  walk(merges[merges.length - 1]!.id);
  return out;
}

/** k개 군집으로 자른 라벨 (0..k-1, 잎 순서상 먼저 나오는 군집이 0). 1 ≤ k ≤ n */
export function cutTree(res: HClustResult, k: number): number[] {
  const { n, merges } = res;
  const kk = Math.max(1, Math.min(n, Math.floor(k)));
  // 마지막 (kk-1)번의 병합을 되돌린다
  const applied = merges.slice(0, n - kk);
  const parent = new Map<number, number>();
  for (const mg of applied) {
    parent.set(mg.left, mg.id);
    parent.set(mg.right, mg.id);
  }
  const root = (i: number) => {
    let r = i;
    while (parent.has(r)) r = parent.get(r)!;
    return r;
  };
  const labelOfRoot = new Map<number, number>();
  const labels = new Array<number>(n).fill(-1);
  for (const leaf of res.order) {
    const r = root(leaf);
    if (!labelOfRoot.has(r)) labelOfRoot.set(r, labelOfRoot.size);
    labels[leaf] = labelOfRoot.get(r)!;
  }
  return labels;
}
