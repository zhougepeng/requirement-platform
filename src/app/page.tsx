import { RequirementWorkspace, type WorkspaceView } from "@/components/requirement-workspace";

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string; project?: string }> }) {
  const { view, project } = await searchParams;
  const initialView = ["board", "projects", "requirements", "materials", "my-requirements"].includes(view ?? "")
    ? view as WorkspaceView
    : undefined;
  return <RequirementWorkspace initialView={initialView} initialProjectId={project} />;
}
