import { apiError, apiJson } from "@/lib/api-response";
import type { AssignedRequirement } from "@/lib/types";
import { actorFromRequest } from "@/services/auth/request-actor";
import { listProjects } from "@/services/requirement/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await actorFromRequest(request);
    const projects = await listProjects();
    const assigned: AssignedRequirement[] = [];
    for (const project of projects) {
      for (const requirement of project.requirements) {
        if (requirement.status !== "scheduled") continue;
        const developerIds = requirement.assignedDeveloperIds ?? [];
        const testerIds = requirement.assignedTesterIds ?? [];
        const roles: Array<"developer" | "tester"> = [];
        if (actor) {
          if (developerIds.includes(actor.id)) roles.push("developer");
          if (testerIds.includes(actor.id)) roles.push("tester");
        } else if (developerIds.length || testerIds.length) {
          // Local development has no Feishu identity; keep assigned records
          // visible so the demo can exercise the same workflow.
          if (developerIds.length) roles.push("developer");
          if (testerIds.length) roles.push("tester");
        }
        if (!roles.length) continue;
        assigned.push({ ...requirement, projectId: project.id, projectName: project.name, assignmentRoles: roles });
      }
    }
    assigned.sort((left, right) =>
      (left.scheduledFullDate ?? left.scheduledGrayDate ?? "9999-12-31").localeCompare(right.scheduledFullDate ?? right.scheduledGrayDate ?? "9999-12-31")
      || (left.projectName ?? "").localeCompare(right.projectName ?? "")
      || left.title.localeCompare(right.title)
      || left.code.localeCompare(right.code),
    );
    return apiJson(assigned);
  } catch (error) {
    return apiError(error);
  }
}
