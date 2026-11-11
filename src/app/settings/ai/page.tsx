import type { Metadata } from "next";
import { AiSettingsForm } from "@/components/ai/AiSettingsForm";
import { PageHeader } from "@/components/moodle/PageParts";

export const metadata: Metadata = { title: "AI 설정" };

export default function AiSettingsPage() {
  return (
    <div className="page">
      <PageHeader title="AI 채점 제안 설정" crumbs={[{ label: "Preferences" }, { label: "AI 설정" }]} />
      <AiSettingsForm />
    </div>
  );
}
