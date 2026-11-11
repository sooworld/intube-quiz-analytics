// 답안 속 채점 지시문 감지 (검증기와 Mock이 함께 쓴다).
// 모델이 플래그를 달지 않아도 코드가 직접 찾는다. 완벽한 탐지가 아니라 "사람이 보게 하는" 장치다.
export const INJECTION_PATTERN = /(지시를.{0,10}무시|무시하고|만점을 주|모든 기준에 ?2점|점수를 (올려|높게)|ignore (all|previous)|give (me )?full marks)/i;

/** 지시문이 든 문장의 원문 구간들 [시작, 끝) */
export function instructionSpans(essay: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = /[^.!?。\n]+[.!?。]?/g;
  for (let m = re.exec(essay); m; m = re.exec(essay)) {
    if (INJECTION_PATTERN.test(m[0])) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}
