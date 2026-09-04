import { RequirementWorkspace } from "@/components/requirement-workspace";

export default async function RequirementPage({
  params,
  searchParams,
}: {
  params: Promise<{ requirementCode: string }>;
  searchParams: Promise<{ v?: string; returnTo?: string }>;
}) {
  const [{ requirementCode }, { v, returnTo }] = await Promise.all([params, searchParams]);
  const initialVersionNumber = v && /^\d+$/.test(v) ? Number(v) : undefined;
  const initialReturnTo = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : undefined;
  return <RequirementWorkspace initialRequirementCode={requirementCode} initialVersionNumber={initialVersionNumber} initialReturnTo={initialReturnTo} startInDetail />;
}
