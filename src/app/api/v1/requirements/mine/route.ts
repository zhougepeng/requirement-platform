import { apiError, apiJson } from "@/lib/api-response";
import { publisherFromRequest } from "@/services/auth/request-actor";
import { listProjects } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns only the requirements owned by the current publish-capable user. */
export async function GET(request: Request) {
  try {
    const actor = await publisherFromRequest(request);
    const isLocalMode = process.env.AUTH_MODE !== "feishu";
    const requirements = (await listProjects()).flatMap((project) =>
      project.archivedAt
        ? []
        : project.requirements.flatMap((requirement) => {
            if (requirement.archivedAt) return [];
            const isOwner = isLocalMode
              ? !requirement.ownerId && requirement.owner === actor.name
              : requirement.ownerId === actor.id;
            return isOwner ? [{ ...requirement, projectId: project.id, projectName: project.name }] : [];
          }),
    ).toSorted((left, right) => {
      const leftCreatedAt = Date.parse(left.createdAt ?? "") || 0;
      const rightCreatedAt = Date.parse(right.createdAt ?? "") || 0;
      return rightCreatedAt - leftCreatedAt || left.code.localeCompare(right.code);
    });

    return apiJson(requirements);
  } catch (error) {
    return apiError(error);
  }
}
