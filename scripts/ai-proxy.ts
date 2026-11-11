// 기본 AI 중계. 사용: npm run ai:proxy (로컬은 npm run dev와 함께, 시연은 Codespaces에서: docs/demo-relay.md)
// 제공자 서버는 브라우저 CORS를 허용하지 않으므로, 브라우저는 이 중계를 키 없이 부르고 중계가 .env(또는 Secret)의 LG_API_KEY를 붙인다.
// 기본은 127.0.0.1에만 바인딩한다. RELAY_HOST로 밖에 열면 접속 코드·하루 예산·허용 Origin이 모두 있어야 시작한다.
// 업스트림 호출은 한 번에 1건, 호출 사이 1.1초 이상(초당 1건 한도). 로그에는 본문과 키·코드를 남기지 않는다.
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import {
  BUDGET_FILE,
  checkRequest,
  CODE_HEADER,
  createAuthGuard,
  createLedger,
  MAX_BODY_BYTES,
  MIN_INTERVAL_MS,
  parseRelayConfig,
  preflightHeaders,
  RELAY_PORT,
  REMAINING_HEADER,
  responseHeaders,
  RUN_HEADER,
  UPSTREAM_ORIGIN,
  UPSTREAM_TIMEOUT_MS,
  type RelayErrorCode,
} from "./relay/policy";

const apiKey = process.env.LG_API_KEY?.trim() ?? "";
if (!apiKey) {
  console.error("[중계] LG_API_KEY가 없습니다(.env 또는 Secret 확인).");
  process.exit(1);
}
const parsed = parseRelayConfig(process.env);
if (!parsed.ok) {
  for (const p of parsed.problems) console.error(`[중계] ${p}`);
  process.exit(1);
}
const cfg = parsed.config;
const guard = createAuthGuard();
// 예산이 있으면 파일에 기록해 재시작해도 이어진다(같은 날짜 안에서). 예산이 없으면 이 실행 동안만 센다
const ledger = createLedger({
  budget: cfg.budget,
  store: {
    load: () => {
      try {
        return readFileSync(BUDGET_FILE, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    save: (text) => writeFileSync(BUDGET_FILE, text),
  },
});

let busy = false;
let lastCallAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sendJson(res: http.ServerResponse, status: number, headers: Record<string, string>, message: string, code?: RelayErrorCode | "relay_busy") {
  res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: { message, ...(code ? { code } : {}) } }));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too-large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function budgetText() {
  const u = ledger.usage(null);
  return u.budget === null ? `오늘 ${u.used}건` : `오늘 ${u.used}/${u.budget}`;
}

function log(method: string | undefined, path: string, status: number | string, started: number, remaining?: string | null) {
  const left = remaining ? ` · LG 남은 한도 ${remaining}` : "";
  console.log(`[중계] ${new Date().toLocaleTimeString()} ${method} ${path} → ${status} (${Date.now() - started}ms) · ${budgetText()}${left}`);
}

const header = (req: http.IncomingMessage, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", "http://relay");
  const path = url.pathname;
  const verdict = checkRequest(
    {
      method: req.method,
      path,
      host: req.headers.host,
      origin: req.headers.origin,
      contentType: req.headers["content-type"],
      contentLength: Number(req.headers["content-length"] ?? 0),
      code: header(req, CODE_HEADER),
      runId: header(req, RUN_HEADER),
    },
    cfg,
    guard,
  );
  if (!verdict.ok) {
    // 허용하지 않은 Origin·Host에는 CORS 헤더를 붙이지 않는다. 허용된 Origin의 인증 실패는 붙여서 브라우저가 본문을 읽게 한다
    if (verdict.cors) sendJson(res, verdict.status, responseHeaders(verdict.origin), verdict.reason, verdict.code);
    else sendJson(res, verdict.status, {}, verdict.reason);
    log(req.method, path, `${verdict.status} 거부(${verdict.reason})`, started);
    return;
  }
  if (verdict.route.kind === "preflight") {
    res.writeHead(204, preflightHeaders(verdict.origin));
    res.end();
    return;
  }
  const headers = responseHeaders(verdict.origin);
  // 사용량 조회는 업스트림을 부르지 않으므로 busy와 무관하게 바로 답한다
  if (verdict.route.kind === "usage") {
    const run = url.searchParams.get("run");
    res.writeHead(200, { ...headers, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(ledger.usage(run && /^[A-Za-z0-9_-]{1,64}$/.test(run) ? run : null)));
    return;
  }
  const route = verdict.route;
  if (busy) {
    sendJson(res, 429, headers, "중계가 이미 요청 1건을 처리하고 있습니다. 잠시 뒤 다시 시도하세요.", "relay_busy");
    log(req.method, path, "429 (중계 사용 중)", started);
    return;
  }
  busy = true;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, UPSTREAM_TIMEOUT_MS);
  // 브라우저가 연결을 끊으면(화면 이탈·취소) 업스트림 요청도 멈춘다
  res.on("close", () => {
    if (!res.writableEnded) ctrl.abort();
  });
  try {
    const body = route.method === "POST" ? await readBody(req) : undefined;
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (ctrl.signal.aborted) throw new Error("aborted");
    // 생성 호출(chat/completions)만 예산에 센다. 보내기 직전에 예약하므로 전송 전에 취소하면 세지 않는다
    if (route.path === "/v1/chat/completions") {
      const r = ledger.reserve(verdict.runId);
      if (!r.ok) {
        sendJson(res, r.code === "relay_budget" ? 429 : 503, headers, r.reason, r.code);
        log(req.method, path, `${r.code === "relay_budget" ? 429 : 503} (${r.code})`, started);
        return;
      }
    }
    lastCallAt = Date.now();
    const up = await fetch(UPSTREAM_ORIGIN + route.path, {
      method: route.method,
      headers: { authorization: `Bearer ${apiKey}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body,
      signal: ctrl.signal,
    });
    const text = await up.text();
    const remaining = up.headers.get(REMAINING_HEADER);
    res.writeHead(up.status, {
      ...headers,
      "content-type": up.headers.get("content-type") ?? "application/json",
      ...(remaining ? { [REMAINING_HEADER]: remaining } : {}),
    });
    res.end(text);
    log(req.method, path, up.status, started, remaining);
    // 업스트림 오류 본문은 원인 파악에 필요하므로 앞부분만 남긴다(키는 가림). 성공 본문(답안·채점)은 찍지 않는다
    if (!up.ok) console.log(`[중계]   오류 본문: ${text.split(apiKey).join("[키 가림]").slice(0, 300)}`);
  } catch (err) {
    if (res.writableEnded || res.destroyed) {
      log(req.method, path, "브라우저가 연결을 끊음(업스트림 취소)", started);
    } else if (err instanceof Error && err.message === "too-large") {
      sendJson(res, 413, headers, "본문이 너무 큽니다.");
      log(req.method, path, 413, started);
    } else if (timedOut) {
      sendJson(res, 504, headers, "업스트림 응답 시간이 초과되었습니다.");
      log(req.method, path, 504, started);
    } else {
      sendJson(res, 502, headers, "업스트림에 연결하지 못했습니다.");
      log(req.method, path, 502, started);
    }
  } finally {
    clearTimeout(timer);
    busy = false;
  }
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") console.error(`[중계] ${RELAY_PORT} 포트가 이미 쓰이고 있습니다. 이미 띄운 중계가 있는지 확인하세요.`);
  else console.error(`[중계] 시작하지 못했습니다: ${err.code ?? err.message}`);
  process.exit(1);
});

server.listen(RELAY_PORT, cfg.host, () => {
  const mode = cfg.code ? `접속 코드 사용 · 예산 ${cfg.budget ?? "없음"} · ${budgetText()}` : "접속 코드 없음(로컬)";
  console.log(`[중계] http://${cfg.host}:${RELAY_PORT} → ${UPSTREAM_ORIGIN} (${mode})`);
  console.log(`[중계] 허용 Origin: ${cfg.origins.join(", ")}`);
  if (cfg.host === "127.0.0.1") console.log("[중계] 다른 터미널에서 npm run dev를 실행하세요. 끝내려면 Ctrl+C");
});
