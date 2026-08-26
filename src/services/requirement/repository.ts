import "server-only";

import * as localStore from "@/services/requirement/local-store";

export type PublishRequirementInput = localStore.PublishRequirementInput;
export type CreateProjectInput = localStore.CreateProjectInput;
export type UpdateProjectInput = localStore.UpdateProjectInput;

export const listProjects = localStore.listProjects;
export const createProject = localStore.createProject;
export const updateProject = localStore.updateProject;
export const getProject = localStore.getProject;
export const getRequirementDetail = localStore.getRequirementDetail;
export const listProjectRequirements = localStore.listProjectRequirements;
export const listVersions = localStore.listVersions;
export const getVersion = localStore.getVersion;
export const listComments = localStore.listComments;
export const searchRequirements = localStore.searchRequirements;
export const findRequirementKnowledge = localStore.findRequirementKnowledge;
export const addComment = localStore.addComment;
export const uploadArtifact = localStore.uploadArtifact;
export const publishRequirement = localStore.publishRequirement;
