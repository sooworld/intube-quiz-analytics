"use client";
// 작업별 모델 선택 (docs/decisions.md §8.1 U7). 공통 설정을 따르거나, Mock, 공통 제공자의 다른 모델을 고른다.
import { InfoTip } from "@/components/moodle/InfoTip";
import { CAPABILITIES, providerModelLabel } from "@/lib/ai/capabilities";
import { browserAiSettingsStore, type TaskSetting } from "@/lib/ai/keyStore";
import { AI_TASK_IDS, AI_TASK_LABEL, type AiTaskId } from "@/lib/ai/task";
import { useAiSettings } from "@/lib/ai/useAiSettings";

/** Gemini 무료 등급 시연 기본안 (README의 실연 기록 참고) */
const GEMINI_SUGGESTED: Partial<Record<AiTaskId, string>> = {
  "tag-draft": "gemini-3.5-flash-lite",
  "relation-draft": "gemini-3.5-flash-lite",
  "analysis-summary": "gemini-3.5-flash",
};

type Mode = "inherit" | "mock" | "model";

function modeOf(t: TaskSetting | undefined): Mode {
  if (!t) return "inherit";
  return t.provider === "mock" ? "mock" : "model";
}

export function TaskModelTable({ models }: { models: string[] | null }) {
  const s = useAiSettings();
  const store = browserAiSettingsStore;

  const setMode = (task: AiTaskId, mode: Mode) => {
    if (mode === "inherit") store().setTaskSetting(task, null);
    else if (mode === "mock") store().setTaskSetting(task, { provider: "mock" });
    else if (s.provider !== "mock" && s.provider !== "lg") store().setTaskSetting(task, { provider: s.provider, model: GEMINI_SUGGESTED[task] && s.provider === "gemini" ? GEMINI_SUGGESTED[task]! : s.model });
  };

  return (
    <section className="card" aria-labelledby="ai-tasks">
      <h2 className="card-title" id="ai-tasks">
        4. 작업별 모델
        <InfoTip label="작업별 모델">
          <span>작업마다 다른 모델을 쓸 수 있습니다. 키는 공통 제공자({CAPABILITIES[s.provider].label})의 키 하나만 쓰므로, 다른 제공자의 모델은 고를 수 없습니다.</span>
          {s.provider === "gemini" ? (
            <span>
              Gemini 시연 기본안: 태그·관계 초안은 <code>gemini-3.5-flash-lite</code>, 결과 요약은 <code>gemini-3.5-flash</code>. 모델 id는 바뀔 수 있으니 3번의 모델 목록으로 확인하세요.
            </span>
          ) : null}
        </InfoTip>
      </h2>
      <datalist id="task-model-options">
        {(models ?? []).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <div className="table-wrap">
        <table className="data">
          <caption className="visually-hidden">작업별 모델 설정</caption>
          <thead>
            <tr>
              <th scope="col">작업</th>
              <th scope="col">사용 방식</th>
              <th scope="col">실제로 쓸 모델</th>
            </tr>
          </thead>
          <tbody>
            {AI_TASK_IDS.map((task) => {
              const t = s.tasks[task];
              const mode = modeOf(t);
              const mismatch = t && t.provider !== "mock" && t.provider !== s.provider;
              return (
                <tr key={task}>
                  <th scope="row">{AI_TASK_LABEL[task]}</th>
                  <td>
                    <label className="visually-hidden" htmlFor={`mode-${task}`}>
                      {AI_TASK_LABEL[task]} 사용 방식
                    </label>
                    <select id={`mode-${task}`} value={mode} onChange={(e) => setMode(task, e.target.value as Mode)}>
                      <option value="inherit">공통 설정 따름</option>
                      <option value="mock">Mock (규칙 기반, AI 아님)</option>
                      {/* 기본 AI는 모델이 하나뿐이라 다른 모델을 고를 수 없다 */}
                      <option value="model" disabled={(s.provider === "mock" || s.provider === "lg") && mode !== "model"}>
                        공통 제공자의 다른 모델
                      </option>
                    </select>
                  </td>
                  <td>
                    {mode === "inherit" ? (
                      <span className="small">
                        {providerModelLabel(s.provider, s.model)}
                      </span>
                    ) : mode === "mock" ? (
                      <span className="small">rules-v1 (네트워크 사용 안 함)</span>
                    ) : t && t.provider !== "mock" ? (
                      <>
                        <label className="visually-hidden" htmlFor={`model-${task}`}>
                          {AI_TASK_LABEL[task]} 모델 id
                        </label>
                        <input
                          id={`model-${task}`}
                          type="text"
                          list="task-model-options"
                          spellCheck={false}
                          key={`${task}-${t.model}`}
                          defaultValue={t.model}
                          onBlur={(e) => e.target.value.trim() && store().setTaskSetting(task, { provider: t.provider, model: e.target.value })}
                        />
                        {mismatch ? (
                          <p className="small text-danger" role="alert">
                            {CAPABILITIES[t.provider].label}용 설정입니다. 공통 제공자가 바뀌어 실행이 막힙니다. 다시 고르세요.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
