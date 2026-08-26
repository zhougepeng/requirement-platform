import { RequirementWorkspace } from "@/components/requirement-workspace";

export default async function RequirementPage({
  params,
  searchParams,
}: {
  params: Promise<{ requirementCode: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const [{ requirementCode }, { v }] = await Promise.all([params, searchParams]);
  const initialVersionNumber = v && /^\d+$/.test(v) ? Number(v) : undefined;
  return <RequirementWorkspace initialRequirementCode={requirementCode} initialVersionNumber={initialVersionNumber} startInDetail />;
}
