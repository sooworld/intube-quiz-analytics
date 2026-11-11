// xAPI Statement 검증 (Learning Locker xapi-validation, xAPI 1.0.x 기준).
// 2.0 수용은 이 검증으로 주장하지 않는다 (docs/xapi-plan.md §3.7). 개발 전용 의존성이라 앱 코드에서 import하지 않는다.
import * as xv from "xapi-validation";
import type { XStatement } from "../../src/lib/xapi/vocab";

type Warning = { path?: string[]; message?: string; data?: unknown };
type Validate = (data: unknown) => Warning[];

// CJS 패키지라 실행 환경(tsx, vitest)에 따라 default가 한 겹 더 감싸여 온다
const mod = xv as unknown as { default: Validate | { default: Validate } };
const validate: Validate = typeof mod.default === "function" ? mod.default : mod.default.default;

export const VALIDATOR = "xapi-validation@2.1.4";
export const SPEC_BASIS = "xAPI 1.0.3 (Learning Locker validator)";

export interface ValidationProblem {
  statementId: string;
  paths: string[];
}

export function validateStatements(statements: XStatement[]): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  for (const s of statements) {
    const warnings = validate(s);
    if (warnings.length) problems.push({ statementId: s.id, paths: warnings.map((w) => (w.path ?? []).join(".")) });
  }
  return problems;
}
