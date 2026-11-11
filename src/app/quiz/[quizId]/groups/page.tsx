import type { Metadata } from "next";
import { GroupProposal } from "@/components/analysis/GroupProposal";

export const metadata: Metadata = { title: "보충 그룹" };

export default function GroupsPage() {
  return <GroupProposal />;
}
