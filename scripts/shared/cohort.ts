// 학생·응시·프로필 배정 (quiz-w5와 quiz-w5e가 같은 학생 집단을 쓰도록 공유).
// 주의: generate-data.ts의 난수 소비 순서를 바꾸면 quiz-w5.json이 달라진다.
// buildCohort는 rng(SEED)의 **첫 소비자**여야 한다.
import type { Attempt, Student } from "../../src/lib/types";

export const SEED = 20261109;

// mulberry32
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 학생 프로필: 개념별 경향. 파일에는 저장하지 않는다(화면이 정답을 미리 알지 않게).
export type Profile = "strong" | "pathWeak" | "sortWeak" | "bigOWeak" | "mixed";

/** 프로필별 개념 강도(객관식 정답 확률). 서술형에서는 루브릭 수준 분포를 정하는 데 쓴다 */
export const PROFILE_STRENGTH: Record<Profile, Record<string, number>> = {
  strong: { "c-hyp": 0.9, "c-reg": 0.9, "c-clu": 0.85, "c-dist": 0.9 },
  pathWeak: { "c-hyp": 0.75, "c-reg": 0.75, "c-clu": 0.6, "c-dist": 0.2 },
  sortWeak: { "c-hyp": 0.7, "c-reg": 0.25, "c-clu": 0.7, "c-dist": 0.75 },
  bigOWeak: { "c-hyp": 0.2, "c-reg": 0.6, "c-clu": 0.75, "c-dist": 0.7 },
  mixed: { "c-hyp": 0.5, "c-reg": 0.5, "c-clu": 0.5, "c-dist": 0.5 },
};

export const names = [
  "김하늘", "이서준", "박지민", "최윤서", "정도윤", "강하린", "조민재", "윤채원", "장시우", "임서연",
  "한지호", "오예린", "서건우", "신다은", "권태민", "황수아", "안준혁", "송나윤", "전우진", "홍지유",
  "고은찬", "문가온", "양태윤", "배소율", "백승현", "남유나",
];

export interface Cohort {
  students: Student[];
  attempts: Attempt[];
  /** 응시 완료 학생 순서(attempts 인덱스)대로의 프로필. 미응시 학생은 없음 */
  profiles: Profile[];
}

export function buildCohort(rand: () => number): Cohort {
  const profiles: Profile[] = [
    ...Array<Profile>(5).fill("strong"),
    ...Array<Profile>(7).fill("pathWeak"),
    ...Array<Profile>(6).fill("sortWeak"),
    ...Array<Profile>(4).fill("bigOWeak"),
    ...Array<Profile>(3).fill("mixed"),
  ];
  // 프로필 순서가 학생 번호에 드러나지 않도록 섞는다 (Fisher–Yates)
  for (let i = profiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [profiles[i], profiles[j]] = [profiles[j]!, profiles[i]!];
  }
  const students: Student[] = names.map((name, i) => ({ id: `s${String(i + 1).padStart(2, "0")}`, name }));
  const attempts: Attempt[] = students.map((s, i) => ({
    id: `a-${s.id}`,
    studentId: s.id,
    status: i === students.length - 1 ? "notattempted" : "finished", // 마지막 1명은 미응시
  }));
  return { students, attempts, profiles };
}
