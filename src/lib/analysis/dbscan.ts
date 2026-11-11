// DBSCAN (밀도 기반 군집). 원래 거리 행렬에서 계산한다 (2D 투영 좌표에서 계산하지 않는다).
// minPts는 자기 자신을 포함해 센다 (scikit-learn 관례). 노이즈는 -1 = "현재 조건에서 그룹 미배정".
// 결정성: 학생 인덱스 순서로 탐색하고, 경계점은 먼저 도달한 군집에 배정한다.

export interface DbscanResult {
  labels: number[];
  /** 핵심점 여부 */
  core: boolean[];
  clusterCount: number;
  noiseCount: number;
}

const EPS_TOL = 1e-12;

export function neighbors(dist: number[][], i: number, eps: number): number[] {
  const out: number[] = [];
  const row = dist[i]!;
  for (let j = 0; j < row.length; j++) if (row[j]! <= eps + EPS_TOL) out.push(j);
  return out; // 자기 자신 포함
}

export function dbscan(dist: number[][], eps: number, minPts: number): DbscanResult {
  const n = dist.length;
  const labels = new Array<number>(n).fill(-2); // -2 = 미방문
  const core = dist.map((_, i) => neighbors(dist, i, eps).length >= minPts);
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    if (!core[i]) {
      labels[i] = -1;
      continue;
    }
    labels[i] = c;
    const queue = neighbors(dist, i, eps).filter((j) => j !== i);
    while (queue.length) {
      const j = queue.shift()!;
      if (labels[j] === -1) labels[j] = c; // 노이즈였던 점은 경계점이 된다
      if (labels[j] !== -2) continue;
      labels[j] = c;
      if (core[j]) for (const k of neighbors(dist, j, eps)) if (labels[k] === -2 || labels[k] === -1) queue.push(k);
    }
    c++;
  }
  return { labels, core, clusterCount: c, noiseCount: labels.filter((l) => l === -1).length };
}
