"use client";
// 현재 브라우저의 개인 키 설정 (계획 T4). 키는 화면 상태에 두지 않고 저장소에서만 다룬다.
import Link from "next/link";
import { useRef, useState } from "react";
import { InfoTip } from "@/components/moodle/InfoTip";
import { blockReason, CAPABILITIES, errorHint } from "@/lib/ai/capabilities";
import { browserAiSettingsStore } from "@/lib/ai/keyStore";
import { anthropicListModels } from "@/lib/ai/providers/anthropic";
import { geminiListModels } from "@/lib/ai/providers/gemini";
import { LG_RELAY_BASE, lgListModels } from "@/lib/ai/providers/lg";
import { fetchRunUsage, usageLabel } from "@/lib/ai/relayUsage";
import { OPENAI_DEFAULT_BASE, openaiListModels } from "@/lib/ai/providers/openai";
import { AiError, aiErrorText, PROVIDER_IDS, type ProviderId } from "@/lib/ai/types";
import { useAiSettings } from "@/lib/ai/useAiSettings";
import { TaskModelTable } from "./TaskModelTable";

const fetchImpl = (input: string, init?: RequestInit) => fetch(input, init);

export function AiSettingsForm() {
  const s = useAiSettings();
  const store = browserAiSettingsStore;
  const cap = CAPABILITIES[s.provider];
  const [keyDraft, setKeyDraft] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const changeProvider = (p: ProviderId) => {
    store().setProvider(p);
    setKeyDraft("");
    setModels(null);
    setCheck(null);
  };

  const saveKey = () => {
    if (!keyDraft.trim()) return;
    store().setKey(keyDraft);
    setKeyDraft("");
    setCheck(null);
  };

  /** 모델 목록 불러오기 = 연결 확인(생성 비용 없음) */
  const testConnection = async () => {
    const cfg = store().getConfig();
    // 연결 확인도 키를 보내므로 채점 요청과 같은 차단 규칙(키 없음, http 외부 주소 등)을 거친다
    const blocked = blockReason(cfg, window.location.protocol, "list-models");
    if (blocked) {
      setCheck({ ok: false, text: blocked.message });
      return;
    }
    const apiKey = cfg.apiKey ?? "";
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setCheck(null);
    try {
      const list =
        cfg.provider === "lg"
          ? await lgListModels({ baseUrl: cfg.baseUrl, relayCode: cfg.relayCode, signal: c.signal, fetchImpl })
          : cfg.provider === "gemini"
          ? await geminiListModels({ apiKey, signal: c.signal, fetchImpl })
          : cfg.provider === "anthropic"
            ? await anthropicListModels({ apiKey, signal: c.signal })
            : await openaiListModels({ apiKey, baseUrl: cfg.baseUrl, signal: c.signal, fetchImpl });
      setModels(list);
      // 중계는 오늘 호출 수(와 예산)도 알려 준다. 사용량 조회는 LG를 부르지 않는다
      const used = cfg.provider === "lg" ? usageLabel(await fetchRunUsage(cfg, null)) : null;
      setCheck({ ok: true, text: cfg.provider === "lg" ? `연결됨. 중계를 거쳐 AI를 쓸 수 있습니다.${used ? ` ${used}` : ""}` : `연결됨. 이 키로 쓸 수 있는 모델 ${list.length}개를 불러왔습니다.` });
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError("network", "알 수 없는 오류");
      setCheck({ ok: false, text: aiErrorText(e) + errorHint(cfg.provider, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="alert alert-warning">
        {s.provider === "lg" ? (
          <p>
            <strong>AI의 키는 중계에만 있고 브라우저로 오지 않습니다.</strong>
            <InfoTip label="중계">
              <span>
                키는 중계를 띄운 컴퓨터의 <code>.env</code>(공개 중계는 Secret)에만 있습니다. 중계가 키를 붙여 보내는 구조는 실제 운영에서 Moodle 서버가 키를 보관하는 방식과
                같습니다(<code>docs/moodle-ai-integration.md</code>).
              </span>
            </InfoTip>
          </p>
        ) : (
          <p>
            <strong>현재 브라우저의 개인 키 시연입니다.</strong> 로그인이 없는 정적 데모라 교수별 키를 &ldquo;관리&rdquo;하지 않습니다. 키는 이 페이지에서
            제공자로 직접 전송되며, 같은 페이지의 스크립트가 읽을 수 있습니다. 실제 운영에서는 Moodle 서버가 키를 보관해야 합니다
            (<code>docs/moodle-ai-integration.md</code>).
          </p>
        )}
        <p>보낼 수 있는 것은 이 데모의 <strong>가상 답안</strong>뿐입니다. 실제 학생 답안은 기관 계약 키와 Moodle 서버 연동으로만 처리하세요.</p>
      </div>
      {s.storageWarning ? (
        <div className="alert alert-warning" role="status">
          <p>{s.storageWarning}</p>
        </div>
      ) : null}

      <section className="card" aria-labelledby="ai-provider">
        <h2 className="card-title" id="ai-provider">1. 제공자</h2>
        <div className="choice-list" role="radiogroup" aria-labelledby="ai-provider">
          {PROVIDER_IDS.map((p) => (
            <label key={p} className={`choice${s.provider === p ? " is-selected" : ""}`}>
              <input type="radio" name="provider" checked={s.provider === p} onChange={() => changeProvider(p)} />
              <span>
                <strong>{CAPABILITIES[p].label}</strong>
                <span className="small muted"> · {CAPABILITIES[p].verification}</span>
              </span>
            </label>
          ))}
        </div>
        {/* 개발자용 정보(브라우저 호출 방식·출력 형식·인증·한도)는 접어 둔다(decisions U13) */}
        <details className="small tech-details">
          <summary>기술 정보</summary>
          <dl className="kv">
            <dt>브라우저 호출</dt>
            <dd>{cap.browserDirect}</dd>
            <dt>구조화 출력</dt>
            <dd>{cap.structuredOutput}</dd>
            <dt>인증</dt>
            <dd>{cap.auth}</dd>
          </dl>
          {cap.notes.length ? (
            <ul>
              {cap.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </details>
      </section>

      {s.provider === "mock" ? (
        <section className="card">
          <h2 className="card-title">2. 키</h2>
          <p>Mock은 키가 필요 없습니다. 답안을 외부로 보내지 않고 브라우저 안에서 규칙으로 판정합니다.</p>
        </section>
      ) : s.provider === "lg" ? (
        <section className="card" aria-labelledby="ai-relay">
          <h2 className="card-title" id="ai-relay">
            2. 중계와 연결 확인
            <InfoTip label="중계">
              <span>
                AI는 브라우저에 키를 두지 않습니다. 중계가 <code>LG_API_KEY</code>로 대신 호출합니다. 주소를 비워 두면 이 컴퓨터의 로컬 중계를 씁니다.
              </span>
              <span>접속 코드는 시연용 공개 중계에만 필요하고, 입력한 주소로만 보냅니다. 주소를 바꾸면 지워집니다.</span>
              <span>연결 확인은 모델 목록과 오늘 호출 수만 조회하므로 하루 한도를 쓰지 않습니다.</span>
            </InfoTip>
          </h2>
          <label className="field">
            <span>중계 주소 (비우면 로컬 {LG_RELAY_BASE.replace("/v1", "")})</span>
            <input
              type="url"
              key={`relay-${s.relayUrl}`}
              defaultValue={s.relayUrl}
              placeholder="https://… (시연용 공개 중계)"
              spellCheck={false}
              onBlur={(e) => {
                store().setRelayUrl(e.target.value);
                setModels(null);
                setCheck(null);
              }}
            />
          </label>
          <p className="small">
            로컬: 터미널 하나에서 <code>npm run ai:proxy</code>, 다른 터미널에서 <code>npm run dev</code> 후 <code>http://localhost:3000</code>으로 접속
          </p>
          <p>
            접속 코드: {s.hasKey ? <span className="badge badge-ok">입력됨</span> : <span className="badge">없음</span>}{" "}
            <span className="small muted">({s.persist === "session" ? "이 탭을 닫으면 삭제" : "새로고침하면 삭제"})</span>
          </p>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveKey();
            }}
          >
            <label className="field grow">
              <span>접속 코드 (공개 중계만)</span>
              <input type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={s.hasKey ? "새 코드로 바꾸려면 입력" : "접속 코드 붙여넣기"} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={!keyDraft.trim()}>
              코드 적용
            </button>
            <button type="button" className="btn btn-outline" disabled={!s.hasKey} onClick={() => store().clearKey()}>
              코드 지우기
            </button>
          </form>
          <fieldset className="radio-row">
            <legend className="small">접속 코드 보관 방식</legend>
            <label>
              <input type="radio" name="persist" checked={s.persist === "memory"} onChange={() => store().setPersist("memory")} /> 메모리만 (기본, 새로고침하면 사라짐)
            </label>
            <label>
              <input type="radio" name="persist" checked={s.persist === "session"} onChange={() => store().setPersist("session")} /> 이 탭 동안 유지 (sessionStorage)
            </label>
          </fieldset>
          <div className="btn-row">
            <button type="button" className="btn btn-outline" onClick={testConnection} disabled={busy}>
              {busy ? "확인 중…" : "연결 확인"}
            </button>
          </div>
          {check ? (
            <p role="status" className={check.ok ? "text-ok" : "text-danger"}>
              {check.text}
            </p>
          ) : null}
        </section>
      ) : (
        <>
          {s.provider === "openai" ? (
            <section className="card">
              <h2 className="card-title">주소 (base URL)</h2>
              <label className="field">
                <span>엔드포인트</span>
                <input
                  type="url"
                  defaultValue={s.baseUrl}
                  key={`base-${s.provider}`}
                  placeholder={OPENAI_DEFAULT_BASE}
                  onBlur={(e) => {
                    store().setBaseUrl(e.target.value);
                    setModels(null);
                  }}
                />
              </label>
              <p className="small muted">주소를 바꾸면 이전 키는 지워집니다(다른 곳으로 같은 키를 보내지 않기 위해).</p>
            </section>
          ) : null}

          <section className="card" aria-labelledby="ai-key">
            <h2 className="card-title" id="ai-key">
              2. 키
              <InfoTip label="키 보관">
                <span>키는 localStorage·채점 기록·오류 메시지·화면 어디에도 남기지 않습니다. 제공자를 바꾸면 지워집니다.</span>
              </InfoTip>
            </h2>
            <p>
              상태: {s.hasKey ? <span className="badge badge-ok">키 있음</span> : <span className="badge">키 없음</span>}{" "}
              <span className="small muted">({s.persist === "session" ? "이 탭을 닫으면 삭제" : "새로고침하면 삭제"})</span>
            </p>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveKey();
              }}
            >
              <label className="field grow">
                <span>{cap.label} API 키</span>
                <input type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={s.hasKey ? "새 키로 바꾸려면 입력" : "키 붙여넣기"} />
              </label>
              <button type="submit" className="btn btn-primary" disabled={!keyDraft.trim()}>
                키 적용
              </button>
              <button type="button" className="btn btn-outline" disabled={!s.hasKey} onClick={() => store().clearKey()}>
                키 지우기
              </button>
            </form>
            <fieldset className="radio-row">
              <legend className="small">보관 방식</legend>
              <label>
                <input type="radio" name="persist" checked={s.persist === "memory"} onChange={() => store().setPersist("memory")} /> 메모리만 (기본, 새로고침하면 사라짐)
              </label>
              <label>
                <input type="radio" name="persist" checked={s.persist === "session"} onChange={() => store().setPersist("session")} /> 이 탭 동안 유지 (sessionStorage)
              </label>
            </fieldset>
          </section>

          <section className="card" aria-labelledby="ai-model">
            <h2 className="card-title" id="ai-model">
              3. 모델과 연결 확인
              <InfoTip label="연결 확인">
                <span>연결 확인은 모델 목록만 조회하므로 생성 비용이 들지 않습니다.</span>
              </InfoTip>
            </h2>
            <div className="inline-form">
              <label className="field grow">
                <span>모델 id</span>
                <input
                  type="text"
                  key={`model-${s.provider}-${s.model}`}
                  defaultValue={s.model}
                  list="model-options"
                  spellCheck={false}
                  onBlur={(e) => store().setModel(e.target.value)}
                />
                {models ? (
                  <datalist id="model-options">
                    {models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                ) : null}
              </label>
              <button type="button" className="btn btn-outline" onClick={testConnection} disabled={busy || !s.hasKey}>
                {busy ? "확인 중…" : "연결 확인 · 모델 목록 불러오기"}
              </button>
            </div>
            {check ? (
              <p role="status" className={check.ok ? "text-ok" : "text-danger"}>
                {check.text}
              </p>
            ) : null}
            {models && models.length > 0 ? (
              <details>
                <summary className="small">불러온 모델 {models.length}개</summary>
                <ul className="model-list small">
                  {models.map((m) => (
                    <li key={m}>
                      <button type="button" className="btn-link" onClick={() => store().setModel(m)}>
                        {m}
                      </button>
                      {m === s.model ? " ✓" : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </>
      )}

      <TaskModelTable models={models} />

      <p>
        <Link className="btn btn-primary" href="/essay/quiz-w5e/grading/">
          서술형 채점 화면으로
        </Link>
      </p>
    </div>
  );
}
