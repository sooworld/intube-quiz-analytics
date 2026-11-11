import type { Metadata } from "next";
import { QMatrixEditor } from "@/components/analysis/QMatrixEditor";

export const metadata: Metadata = { title: "문제별 개념" };

export default function QMatrixPage() {
  return <QMatrixEditor />;
}
