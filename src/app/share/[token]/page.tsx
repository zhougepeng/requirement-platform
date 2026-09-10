import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { PublicRequirementPreview } from "@/components/public-requirement-preview";
import { getPublicRequirementSharePayload } from "@/services/requirement/public-share";

export const dynamic = "force-dynamic";
export const metadata = { title: "需求预览 · 需求平台" };

export default async function PublicSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || "127.0.0.1:3300";
    const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
    const payload = await getPublicRequirementSharePayload(token, `${protocol}://${host}`);
    return <><link rel="alternate" type="text/markdown" href={payload.markdownUrl} /><PublicRequirementPreview payload={payload} /></>;
  } catch {
    notFound();
  }
}
