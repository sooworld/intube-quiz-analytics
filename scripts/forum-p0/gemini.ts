// Gemini 임베딩 (batchEmbedContents) + 파일 캐시. 키는 x-goog-api-key 헤더로만 보내고 출력하지 않는다.
// 캐시에 있는 (taskType, 글)은 다시 부르지 않는다. 실패해도 재시도하지 않는다 (테스트 예산).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const BATCH = 100;

export type TaskType = "SEMANTIC_SIMILARITY" | "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";
export type EmbedRequest = { text: string; taskType: TaskType };

export type EmbedCache = {
  requestedModel: string;
  /** `${taskType}|sha256(글)` → 벡터 */
  entries: Record<string, number[]>;
  calls: { at: string; texts: number }[];
};

const keyOf = (r: EmbedRequest) => `${r.taskType}|${createHash("sha256").update(r.text, "utf8").digest("hex")}`;

export function loadCache(path: string, model: string): EmbedCache {
  if (!existsSync(path)) return { requestedModel: model, entries: {}, calls: [] };
  const c = JSON.parse(readFileSync(path, "utf8")) as EmbedCache;
  if (c.requestedModel !== model) throw new Error(`캐시 모델(${c.requestedModel})과 요청 모델(${model})이 다릅니다: ${path}`);
  return c;
}

async function failure(res: Response): Promise<Error> {
  let reason = "";
  try {
    const j = (await res.json()) as { error?: { status?: string; message?: string } };
    reason = `${j.error?.status ?? ""} ${(j.error?.message ?? "").slice(0, 160)}`;
  } catch {
    /* 본문이 JSON이 아니면 상태 코드만 */
  }
  return new Error(`Gemini ${res.status} ${reason}`.trim());
}

async function assertEmbeddingModel(apiKey: string, model: string): Promise<void> {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) throw await failure(res);
  const json = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
  const embedders = (json.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.some((x) => /embed/i.test(x)))
    .map((m) => (m.name ?? "").replace(/^models\//, ""));
  if (!embedders.includes(model)) {
    throw new Error(`이 키로 쓸 수 없는 임베딩 모델입니다: ${model}. 쓸 수 있는 모델: ${embedders.join(", ") || "(없음)"}`);
  }
}

/** 캐시에 없는 요청만 보내 캐시에 채운다. 반환값은 새로 보낸 HTTP 요청 수. */
export async function fillCache(opts: { apiKey: string; requests: EmbedRequest[]; cache: EmbedCache; cachePath: string }): Promise<number> {
  const { apiKey, cache, cachePath } = opts;
  const seen = new Set<string>();
  const missing = opts.requests.filter((r) => {
    const k = keyOf(r);
    if (k in cache.entries || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (missing.length === 0) return 0;
  await assertEmbeddingModel(apiKey, cache.requestedModel);
  let sent = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const res = await fetch(`${BASE}/models/${cache.requestedModel}:batchEmbedContents`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        requests: chunk.map((r) => ({ model: `models/${cache.requestedModel}`, content: { parts: [{ text: r.text }] }, taskType: r.taskType })),
      }),
    });
    sent += 1;
    if (!res.ok) throw await failure(res);
    const json = (await res.json()) as { embeddings?: { values?: number[] }[] };
    const vecs = json.embeddings ?? [];
    if (vecs.length !== chunk.length) throw new Error(`임베딩 개수가 다릅니다: 요청 ${chunk.length}, 응답 ${vecs.length}`);
    chunk.forEach((r, k) => {
      const v = vecs[k]?.values;
      if (!v || v.length === 0) throw new Error(`빈 임베딩: ${r.text.slice(0, 20)}…`);
      cache.entries[keyOf(r)] = v;
    });
    // 청크마다 저장해 중간에 실패해도 받은 것은 남긴다.
    cache.calls.push({ at: new Date().toISOString(), texts: chunk.length });
    writeFileSync(cachePath, JSON.stringify(cache));
  }
  return sent;
}

export const vectorFor = (cache: EmbedCache, r: EmbedRequest): number[] | undefined => cache.entries[keyOf(r)];
