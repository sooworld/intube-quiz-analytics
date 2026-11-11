"use client";

import { useState } from "react";
import type { XStatement } from "@/lib/xapi/vocab";

/** Statement 원문. 펼칠 때만 그린다 (목록이 수백 건이어도 DOM을 키우지 않게) */
export function StatementJson({ s }: { s: XStatement }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="xapi-json" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="small">
        <code>{s.id.slice(0, 8)}</code> 원문 JSON
      </summary>
      {open ? <pre>{JSON.stringify(s, null, 2)}</pre> : null}
    </details>
  );
}
