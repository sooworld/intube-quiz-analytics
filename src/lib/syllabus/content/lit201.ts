// LIT201 가상 강의계획서. 데모에 있는 3주차 토론(lit-f3)에서 거꾸로 만들었다(사용자 결정 2026-11-27).
// 토론 목표 text와 주차 topic은 지금 데이터와 글자 그대로다. detail 작성 규칙은 algo101.ts와 같다.
import type { Syllabus } from "../types";

export const SYLLABUS_LIT201: Syllabus = {
  courseId: "lit201",
  overview:
    "한국 현대시를 소리 내어 읽고, 작품의 구절을 근거로 해석을 세우고 나누는 연습을 합니다. 화자와 어조, 율격, 반어·역설 같은 개념을 익히고 1920년대 시를 전통과 근대의 맥락에서 읽습니다.",
  weeks: [
    { week: 1, topic: "시를 읽는 방법", content: "화자와 어조, 시어의 함축, 소리 내어 읽기", method: "강의 · 낭독" },
    { week: 2, topic: "민요시와 율격", content: "7·5조와 3음보, 민요의 가락과 근대시, 이별 노래의 계보", method: "강의 · 낭독" },
    { week: 3, topic: "김소월", content: "「진달래꽃」 정독, 반어로 읽기와 말 그대로 읽기, 구절을 근거로 한 해석 토론", method: "강의 · 온라인 토론" },
    { week: 4, topic: "한용운", content: "「님의 침묵」 정독, 역설의 짜임", method: "강의 · 토의" },
  ],
  concepts: [
    {
      id: "l-speaker",
      weeks: [1],
      name: "화자와 어조",
      description: "시 속 말하는 이와 그 말투가 드러내는 태도",
      detail: "시인과 구별되는 시 속의 말하는 이를 찾는다. 문장을 끝맺는 방식, 공손함의 정도, 되풀이되는 말 같은 말투의 단서로 그가 대상을 어떻게 대하는지 읽는다.",
    },
    {
      id: "l-meter",
      weeks: [2],
      name: "민요조 율격",
      description: "7·5조와 3음보로 대표되는 민요의 가락",
      detail: "민요의 음보 단위 가락을 소리 내어 읽으며 확인하고, 1920년대 시인들이 이 가락을 근대시에 들여온 흐름을 살핀다.",
    },
    {
      id: "l-han",
      weeks: [2, 3],
      name: "정한",
      description: "이별의 슬픔을 안으로 삭이는 전통적 정서",
      detail: "고려가요에서 이어지는 이별 노래의 계보 속에서, 떠나는 사람을 붙잡지 못하고 슬픔을 안으로 삭이는 정서를 정한이라 부르는 관습을 익힌다.",
    },
    {
      id: "l-irony",
      weeks: [3],
      name: "반어",
      description: "겉으로 한 말과 속뜻이 어긋나게 하는 표현",
      detail: "말한 내용과 실제로 전하려는 뜻이 반대로 어긋나는 표현을 반어라 하고, 역설과 구별한다. 앞뒤 문맥과 말투를 근거로 반어로 읽을 수 있는지 따진다.",
    },
    {
      id: "l-paradox",
      weeks: [4],
      name: "역설",
      description: "모순되어 보이는 말 속에 진실을 담는 표현",
      detail: "이별과 만남처럼 서로 어긋나는 말이 한 구절에 맞물리는 짜임을 찾고, 그 모순이 무엇을 말하려는지 해석한다.",
    },
  ],
  objectives: [
    {
      id: "w3-form",
      scope: { kind: "weeks", weeks: [3] },
      kind: "content",
      text: "반복·종결어미·높임 표현 같은 형식 요소를 근거로 화자의 태도를 해석한다",
      detail: "시를 소리 내어 읽으며 되풀이되는 말, 문장을 끝맺는 방식, 공손함의 정도를 표시한다. 이 표시들을 묶어 말하는 이가 체념하는지, 원망하는지, 붙잡고 싶어 하는지 해석의 근거로 쓴다.",
      conceptIds: ["l-speaker"],
    },
    {
      id: "w3-irony",
      scope: { kind: "weeks", weeks: [3] },
      kind: "content",
      text: "반어를 개념으로 설명하고 작품의 구절에 적용한다",
      detail: "반어의 정의를 자기 말로 설명하고, 작품에서 겉말과 속뜻이 어긋나 보이는 구절을 골라 반어로 읽을 때와 말 그대로 읽을 때의 해석을 비교한다.",
      conceptIds: ["l-irony"],
    },
    {
      id: "w3-context",
      scope: { kind: "weeks", weeks: [2, 3] },
      kind: "content",
      text: "작품을 1920년대 민요조 율격과 이별 노래의 전통(정한) 맥락에서 읽는다",
      detail: "작품의 가락을 음보 단위로 끊어 읽고, 이별 노래의 오랜 관습과 견주어 이 작품이 그 관습을 따르는 곳과 비트는 곳을 찾는다.",
      conceptIds: ["l-meter", "l-han"],
    },
    {
      id: "w4-paradox",
      scope: { kind: "weeks", weeks: [4] },
      kind: "content",
      text: "역설의 짜임을 찾아 작품의 중심 생각과 연결한다",
      detail: "서로 어긋나는 말이 맞물린 구절을 찾아 그 짜임을 설명하고, 그 구절이 작품 전체의 생각과 어떻게 이어지는지 쓴다.",
      conceptIds: ["l-paradox"],
    },
    {
      id: "g-interpret",
      scope: { kind: "course" },
      kind: "competency",
      text: "해석 주장을 작품 구절과 연결 이유로 뒷받침한다",
      detail: "해석을 한 문장 주장으로 세우고, 작품에서 구절을 정확히 인용한 뒤, 그 구절이 어떻게 해석의 근거가 되는지 이어 주는 설명을 쓴다.",
      conceptIds: [],
    },
    {
      id: "g-dialog",
      scope: { kind: "course" },
      kind: "competency",
      text: "다른 해석을 정확히 옮기고 인정·반박·종합한다",
      detail: "다른 사람이 내놓은 해석과 그 근거가 된 구절을 정확히 옮긴 뒤, 받아들일 점과 반박할 점을 나누고 두 해석을 아우르는 읽기가 가능한지 따진다.",
      conceptIds: [],
    },
  ],
  evaluation: [
    { name: "온라인 토론", weight: 30, activityIds: ["lit-f3"] },
    { name: "기말 감상 보고서", weight: 50, activityIds: [] },
    { name: "수업 참여", weight: 20, activityIds: [] },
  ],
  provenance: "가상 강의계획서 — 데모의 기존 토론에서 거꾸로 만든 것입니다. 실제 강좌의 계획서가 아닙니다.",
};
