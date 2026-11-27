// 활동 화면에서 강의계획서 항목으로 가는 링크 + ⓘ 상세 (docs/decisions.md U19, 계획 T6).
// 서버·클라이언트 컴포넌트 어디서나 쓴다(훅 없음). 상세는 ⓘ 안에만 둬 좁은 표가 넘치지 않게 한다.
import Link from "next/link";
import type { ReactNode } from "react";
import { InfoTip } from "@/components/moodle/InfoTip";
import { itemKindLabel, refScopeLabel, syllabusHref } from "@/lib/syllabus/resolve";
import type { SyllabusItem } from "@/lib/syllabus/types";

/** 기본 글자는 "계획서 5주차" / "계획서 강좌 역량". children을 주면 그 글자를 링크로 쓴다(예: 개념 이름) */
export function SyllabusRef({ courseId, item, children }: { courseId: string; item: SyllabusItem; children?: ReactNode }) {
  const title = item.type === "concept" ? item.name : item.text;
  const scope = refScopeLabel(item);
  return (
    <span className="syl-ref">
      <Link href={syllabusHref(courseId, item.id)}>{children ?? `계획서 ${scope}`}</Link>
      <InfoTip label={`계획서 항목 ${title}`}>
        <span>
          <strong>
            {itemKindLabel(item)} · {scope}
          </strong>{" "}
          {title}
        </span>
        <span>{item.detail}</span>
        <span className="muted">가상 강의계획서(기존 활동에서 거꾸로 쓴 것)</span>
      </InfoTip>
    </span>
  );
}
