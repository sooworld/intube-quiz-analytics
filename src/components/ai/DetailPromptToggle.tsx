"use client";
// 실행 버튼 앞에서 v1/v2 프롬프트를 고른다 (docs/decisions.md U19, 계획 T5).
// v2(계획서 상세 포함)는 실호출 비교 전이라, 키를 넣으면 바로 실행되기 전에 끌 수 있어야 한다.
// Mock은 프롬프트를 쓰지 않으므로 체크박스를 끄고 비활성화한다(Mock 초안에 v2가 찍히지 않게).
import { InfoTip } from "@/components/moodle/InfoTip";

export function DetailPromptToggle({ checked, onChange, usesMock, disabled }: { checked: boolean; onChange: (v: boolean) => void; usesMock: boolean; disabled?: boolean }) {
  return (
    <div className="detail-toggle">
      <label className="small">
        <input type="checkbox" checked={checked && !usesMock} disabled={usesMock || disabled} onChange={(e) => onChange(e.target.checked)} /> 계획서 상세를 프롬프트에 넣기{" "}
        <span className="badge badge-demo">v2 · 실호출 검증 전</span>
      </label>
      <InfoTip label="계획서 상세 프롬프트">
        <span>
          켜면 강의계획서 항목의 학습내용 상세를 함께 보냅니다(v2). 끄면 계획서 도입 전과 글자까지 같은 프롬프트(v1)를 보냅니다. 상세가 판정을 낫게 하는지는 아직 실제 모델로 비교하지 않았습니다.
        </span>
        <span>계획서는 이 데모의 기존 활동에서 거꾸로 쓴 가상 문서라, v2 결과가 좋아 보여도 근거가 되지 않습니다.</span>
      </InfoTip>
      {usesMock ? <span className="small muted">Mock(규칙 기반)은 프롬프트·상세를 쓰지 않습니다.</span> : null}
    </div>
  );
}
