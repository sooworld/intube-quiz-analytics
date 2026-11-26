// 원래 scripts/forum-p0/tfidf.ts (P0). 토론 화면(브라우저)과 B2 스크립트가 함께 쓰도록 2026-11-26에 옮겼다. 규칙은 바꾸지 않았다.
// 문자 n-gram TF-IDF (어휘 기준선). scikit-learn TfidfVectorizer(analyzer="char_wb",
// sublinear_tf=True, smooth_idf=True, norm="l2")와 같은 규칙을 따른다.
// 다른 점 하나: unseen="max"이면 학습 집합에 없던 n-gram을 버리지 않고 df=0으로 본다.
// 그래야 IDF를 강의 자료로만 미리 학습해도 답글 벡터의 정규화가 왜곡되지 않는다.

export type SparseVec = Map<string, number>;

export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}*+]+/gu, " ")
    .trim();
}

/** 단어마다 앞뒤에 공백을 붙여 n글자씩 자른다. 단어가 n보다 짧으면 한 번만 센다. */
export function charWbNgrams(text: string, nMin: number, nMax: number): string[] {
  const out: string[] = [];
  for (const word of normalizeText(text).split(" ")) {
    if (word === "") continue;
    const w = Array.from(` ${word} `);
    for (let n = nMin; n <= nMax; n++) {
      out.push(w.slice(0, n).join(""));
      let offset = 0;
      while (offset + n < w.length) {
        offset += 1;
        out.push(w.slice(offset, offset + n).join(""));
      }
      if (offset === 0) break;
    }
  }
  return out;
}

export class CharTfidf {
  private idf = new Map<string, number>();
  private unseenIdf = 1;

  constructor(
    private readonly nMin = 2,
    private readonly nMax = 4,
    private readonly unseen: "drop" | "max" = "drop",
  ) {}

  fit(docs: string[]): this {
    const df = new Map<string, number>();
    for (const d of docs) {
      for (const g of new Set(charWbNgrams(d, this.nMin, this.nMax))) df.set(g, (df.get(g) ?? 0) + 1);
    }
    const n = docs.length;
    this.idf = new Map([...df].map(([g, c]) => [g, Math.log((1 + n) / (1 + c)) + 1]));
    this.unseenIdf = Math.log(1 + n) + 1;
    return this;
  }

  transform(doc: string): SparseVec {
    const tf = new Map<string, number>();
    for (const g of charWbNgrams(doc, this.nMin, this.nMax)) {
      if (this.unseen === "max" || this.idf.has(g)) tf.set(g, (tf.get(g) ?? 0) + 1);
    }
    const v: SparseVec = new Map();
    let norm = 0;
    for (const [g, c] of tf) {
      const w = (1 + Math.log(c)) * (this.idf.get(g) ?? this.unseenIdf);
      v.set(g, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [g, w] of v) v.set(g, w / norm);
    return v;
  }
}

/** 둘 다 L2 정규화된 희소 벡터의 코사인 유사도. */
export function sparseCosine(a: SparseVec, b: SparseVec): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [g, w] of small) dot += w * (large.get(g) ?? 0);
  return dot;
}

export function denseCosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
