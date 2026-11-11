"use client";

import { useId, type ReactNode } from "react";
import { Icon } from "./Icon";

/** ⓘ 버튼을 누르면 설명이 뜨는 토글팁. 계산식·주의 문구를 본문에서 빼 텍스트 밀도를 낮춘다. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <>
      <button type="button" className="info-tip-btn" popoverTarget={id} aria-label={`${label} 설명`}>
        <Icon name="info" size={15} />
      </button>
      <span id={id} popover="auto" className="info-tip">
        {children}
      </span>
    </>
  );
}
