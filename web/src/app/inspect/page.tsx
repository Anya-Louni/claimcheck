import type { Metadata } from "next";
import { Workspace } from "@/components/Workspace";

export const metadata: Metadata = {
  title: "Inspection bench · Claimcheck",
  description: "Watch a recorded inspection or run a live one against a Gemini model.",
};

export default async function InspectPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return <Workspace startLive={params.live === "1"} />;
}
