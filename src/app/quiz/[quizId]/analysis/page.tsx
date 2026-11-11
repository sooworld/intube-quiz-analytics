import type { Metadata } from "next";
import { AnalysisDashboard } from "@/components/analysis/AnalysisDashboard";

export const metadata: Metadata = { title: "결과 분석" };

export default function AnalysisPage() {
  return <AnalysisDashboard />;
}
