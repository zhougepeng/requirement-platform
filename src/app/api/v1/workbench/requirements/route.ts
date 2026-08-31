import { apiError, apiJson } from "@/lib/api-response";
import { isAdministratorActor, publisherFromRequest } from "@/services/auth/request-actor";
import { listProjects } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A deliberately scoped integration endpoint: personal tokens only see their
 * own requirements, while an administrator can choose from every requirement.
 */
export async function GET(request: Request) {
  try {
    const actor = await publisherFromRequest(request);
    const isAdmin = await isAdministratorActor(actor);
    const projects = await listProjects();
    const requirements = projects.flatMap((project) =>
      project.requirements
        .filter((requirement) => isAdmin || requirement.ownerId === actor.id)
        .map((requirement) => ({
          projectId: project.id,
          projectName: project.name,
          requirementCode: requirement.code,
          title: requirement.title,
          owner: requirement.owner,
          latestVersion: requirement.latestVersion,
          status: requirement.status ?? "offline",
          updatedAt: requirement.updatedAt,
        })),
    );
    return apiJson({ actor: { id: actor.id, name: actor.name, isAdmin }, requirements });
  } catch (error) {
    return apiError(error);
  }
}
