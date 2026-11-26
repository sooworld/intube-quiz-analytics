import { describe, expect, it } from "vitest";
import { CLAIMS, D_TWINS, LECTURE, LENGTH_IDS, toSentences } from "../scripts/forum-p0/dataset";
import { CharTfidf, charWbNgrams, denseCosine, normalizeText, sparseCosine } from "../scripts/forum-p0/tfidf";

describe("forum P0 TF-IDF", () => {
  it("char_wb는 단어 안에서만 자르고, 짧은 단어는 한 번만 센다", () => {
    expect(charWbNgrams("ab", 2, 3)).toEqual([" a", "ab", "b ", " ab", "ab "]);
    expect(charWbNgrams("a", 2, 4)).toEqual([" a", "a ", " a "]);
    expect(charWbNgrams("a", 3, 4)).toEqual([" a "]);
  });

  it("정규화는 기호를 공백으로 바꾸되 * 와 + 는 남긴다", () => {
    expect(normalizeText("O(V+E), A*!")).toBe("o v+e a*");
  });

  it("같은 글은 1, 겹치는 n-gram이 없으면 0", () => {
    const tf = new CharTfidf(2, 4, "max").fit(["너비 우선 탐색", "깊이 우선 탐색"]);
    const a = tf.transform("너비 우선 탐색");
    expect(sparseCosine(a, tf.transform("너비 우선 탐색"))).toBeCloseTo(1, 10);
    expect(sparseCosine(a, tf.transform("해시"))).toBe(0);
  });

  it("unseen=drop은 학습에 없던 n-gram을 버리고, max는 df=0으로 남긴다", () => {
    const drop = new CharTfidf(2, 2, "drop").fit(["가나"]);
    const keep = new CharTfidf(2, 2, "max").fit(["가나"]);
    // "가나 다라"에서 drop은 "다라" 쪽 n-gram을 버려 "가나"와 같은 벡터가 된다
    expect(sparseCosine(drop.transform("가나 다라"), drop.transform("가나"))).toBeCloseTo(1, 10);
    expect(sparseCosine(keep.transform("가나 다라"), keep.transform("가나"))).toBeLessThan(0.9);
  });

  it("denseCosine", () => {
    expect(denseCosine([1, 0], [2, 0])).toBeCloseTo(1, 10);
    expect(denseCosine([1, 0], [0, 3])).toBe(0);
    expect(denseCosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("forum P0 자료 무결성", () => {
  const ids = new Set(LECTURE.map((u) => u.id));

  it("답글 id가 겹치지 않고 30~40개다", () => {
    expect(new Set(CLAIMS.map((c) => c.id)).size).toBe(CLAIMS.length);
    expect(CLAIMS.length).toBeGreaterThanOrEqual(30);
    expect(CLAIMS.length).toBeLessThanOrEqual(40);
  });

  it("gold는 모두 있는 강의 문단이고, 강의에 없음·주장 없음 글만 gold가 비어 있다", () => {
    for (const c of CLAIMS) {
      for (const g of c.gold) expect(ids.has(g), `${c.id} → ${g}`).toBe(true);
      const empty = ["not-covered", "off-topic", "no-claim"].includes(c.relation);
      expect(c.gold.length === 0, c.id).toBe(empty);
    }
  });

  it("오개념 쌍은 서로를 가리키고 틀림/맞음이 짝을 이룬다", () => {
    for (const c of CLAIMS.filter((x) => x.category === "a-wrong" || x.category === "a-right")) {
      const p = CLAIMS.find((x) => x.id === c.pair);
      expect(p?.pair, c.id).toBe(c.id);
      expect(p?.category).toBe(c.category === "a-wrong" ? "a-right" : "a-wrong");
      expect(p?.gold).toEqual(c.gold);
    }
  });

  it("쌍둥이와 길이 변형은 있는 d·답글을 가리킨다", () => {
    for (const id of Object.keys(D_TWINS)) expect(CLAIMS.find((c) => c.id === id)?.category).toBe("d");
    for (const id of LENGTH_IDS) expect(CLAIMS.some((c) => c.id === id)).toBe(true);
  });

  it("문장 분할은 문단마다 한 문장 이상이고 원문을 잃지 않는다", () => {
    const sents = toSentences(LECTURE);
    for (const u of LECTURE) {
      const mine = sents.filter((s) => s.parent === u.id);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.map((s) => s.text).join(" ")).toBe(u.text);
    }
  });
});
