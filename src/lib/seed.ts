import type { RequirementStore } from "@/lib/types";

export function createInitialStore(): RequirementStore {
  return {
    schemaVersion: 1,
    projects: [],
    requirements: [],
    versions: [],
    comments: [],
    artifacts: [],
    products: [],
    projectProducts: [],
    productSpecs: [],
  };
}
