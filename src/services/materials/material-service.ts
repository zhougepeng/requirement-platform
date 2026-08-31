import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type MaterialScope = "project" | "public";
export type MaterialOrigin = "manual" | "system_generated";
export type Material = {
  id: string;
  scope: MaterialScope;
  projectId?: string;
  directoryId?: string;
  title: string;
  fileName?: string;
  content: string;
  origin: MaterialOrigin;
  /** 人工编辑过的系统整理资料不再被自动提取结果覆盖。 */
  userManaged?: boolean;
  sourceRequirementCodes: string[];
  createdAt: string;
  updatedAt: string;
};

export type MaterialDirectory = { id: string; name: string; scope: MaterialScope; projectId?: string; parentId?: string; createdAt: string; updatedAt: string };
type MaterialStore = { schemaVersion: 1; materials: Material[]; directories: MaterialDirectory[] };

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const STORE_FILE = path.join(DATA_DIR, "materials.local.json");
const MAX_CONTENT_LENGTH = 400_000;
let mutationQueue = Promise.resolve();

function now() {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date()).replaceAll("/", "-");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeTitle(value: string) {
  const title = value.trim();
  if (!title || title.length > 120) throw new Error("资料标题不能为空且不能超过 120 个字符。");
  return title;
}

function normalizeContent(value: string) {
  const content = value.replace(/\r\n/g, "\n").trim();
  if (!content || content.length > MAX_CONTENT_LENGTH) throw new Error("资料内容不能为空且不能超过 40 万字符。");
  return content;
}

async function readStore(): Promise<MaterialStore> {
  try {
    const parsed = JSON.parse(await readFile(STORE_FILE, "utf8")) as Partial<MaterialStore>;
    return {
      schemaVersion: 1,
      materials: Array.isArray(parsed.materials) ? parsed.materials.filter((item): item is Material => Boolean(item?.id && item.title && item.content && (item.scope === "project" || item.scope === "public"))).map((item) => ({
        ...item,
        origin: item.origin === "system_generated" ? "system_generated" : "manual",
        userManaged: item.userManaged === true,
        sourceRequirementCodes: Array.isArray(item.sourceRequirementCodes) ? item.sourceRequirementCodes.filter((code): code is string => typeof code === "string") : [],
      })) : [],
      directories: Array.isArray(parsed.directories) ? parsed.directories.flatMap((item) => {
        if (!item?.id || !item.name) return [];
        return [{
          id: item.id,
          name: item.name,
          scope: item.scope === "project" ? "project" : "public",
          projectId: item.scope === "project" && typeof item.projectId === "string" ? item.projectId : undefined,
          parentId: typeof item.parentId === "string" ? item.parentId : undefined,
          createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
        } satisfies MaterialDirectory];
      }) : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { schemaVersion: 1, materials: [], directories: [] };
    throw error;
  }
}

async function writeStore(store: MaterialStore) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${STORE_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, STORE_FILE);
}

async function mutate<T>(operation: (store: MaterialStore) => T | Promise<T>) {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const store = await readStore();
    const result = await operation(store);
    await writeStore(store);
    return result;
  } finally {
    release();
  }
}

function inScope(item: Material, scope: MaterialScope, projectId?: string, directoryId?: string) {
  if (item.scope !== scope) return false;
  if (scope === "project") return item.projectId === projectId && (directoryId ? item.directoryId === directoryId : !item.directoryId);
  return directoryId ? item.directoryId === directoryId : true;
}

export async function listMaterials(input: { scope: MaterialScope; projectId?: string; directoryId?: string }) {
  if (input.scope === "project" && !input.projectId) throw new Error("项目资料必须指定项目。");
  const store = await readStore();
  return clone(store.materials.filter((item) => inScope(item, input.scope, input.projectId, input.directoryId)).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
}

export async function listAllMaterials() {
  return clone((await readStore()).materials.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
}

export async function getMaterial(id: string) {
  const item = (await readStore()).materials.find((material) => material.id === id);
  if (!item) throw new Error("资料不存在。");
  return clone(item);
}

export async function listMaterialDirectories() {
  return clone((await readStore()).directories.toSorted((left, right) => left.name.localeCompare(right.name, "zh-CN")));
}

export async function createMaterialDirectory(input: { name: string; scope: MaterialScope; projectId?: string; parentId?: string }) {
  const directoryName = normalizeTitle(input.name);
  if (input.scope === "project" && !input.projectId) throw new Error("项目子目录必须指定项目。");
  return mutate((store) => {
    const parent = input.parentId ? store.directories.find((item) => item.id === input.parentId) : undefined;
    if (input.parentId && !parent) throw new Error("父目录不存在。");
    if (parent && (parent.scope !== input.scope || parent.projectId !== input.projectId)) throw new Error("父目录与资料范围不匹配。");
    if (store.directories.some((item) => item.scope === input.scope && item.projectId === input.projectId && item.parentId === input.parentId && item.name === directoryName)) throw new Error("当前目录下已存在同名子目录。");
    const timestamp = now();
    const directory = { id: `dir_${randomUUID().replaceAll("-", "")}`, name: directoryName, scope: input.scope, projectId: input.scope === "project" ? input.projectId : undefined, parentId: input.parentId, createdAt: timestamp, updatedAt: timestamp } satisfies MaterialDirectory;
    store.directories.push(directory);
    return clone(directory);
  });
}

export async function createMaterial(input: { scope: MaterialScope; projectId?: string; directoryId?: string; title: string; content: string; fileName?: string; origin?: MaterialOrigin; sourceRequirementCodes?: string[] }) {
  if (input.scope === "project" && !input.projectId) throw new Error("项目资料必须指定项目。");
  const title = normalizeTitle(input.title);
  const content = normalizeContent(input.content);
  return mutate((store) => {
    const directory = input.directoryId ? store.directories.find((item) => item.id === input.directoryId) : undefined;
    if (input.directoryId && !directory) throw new Error("资料目录不存在。");
    if (directory && (directory.scope !== input.scope || directory.projectId !== (input.scope === "project" ? input.projectId : undefined))) throw new Error("资料目录与资料范围不匹配。");
    const timestamp = now();
    const material: Material = {
      id: `material_${randomUUID().replaceAll("-", "")}`,
      scope: input.scope,
      projectId: input.scope === "project" ? input.projectId : undefined,
      directoryId: input.directoryId,
      title,
      fileName: input.fileName?.trim().slice(0, 180) || undefined,
      content,
      origin: input.origin ?? "manual",
      sourceRequirementCodes: [...new Set(input.sourceRequirementCodes?.filter(Boolean) ?? [])],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.materials.push(material);
    return clone(material);
  });
}

export async function updateMaterial(id: string, input: { title?: string; content?: string; scope?: MaterialScope; projectId?: string; directoryId?: string | null }) {
  return mutate((store) => {
    const material = store.materials.find((item) => item.id === id);
    if (!material) throw new Error("资料不存在。");
    const scope = input.scope ?? material.scope;
    if (material.origin === "system_generated" && scope !== "project") throw new Error("系统整理的项目规范不能移动到公共资料。");
    if (scope === "project" && !(input.projectId ?? material.projectId)) throw new Error("项目资料必须指定项目。");
    const directoryId = Object.hasOwn(input, "directoryId") ? input.directoryId ?? undefined : material.directoryId;
    const directory = directoryId ? store.directories.find((item) => item.id === directoryId) : undefined;
    if (directoryId && !directory) throw new Error("资料目录不存在。");
    if (directory && (directory.scope !== scope || directory.projectId !== (scope === "project" ? input.projectId ?? material.projectId : undefined))) throw new Error("资料目录与资料范围不匹配。");
    if (input.title !== undefined) material.title = normalizeTitle(input.title);
    if (input.content !== undefined) material.content = normalizeContent(input.content);
    if (input.title !== undefined || input.content !== undefined) material.userManaged = true;
    material.scope = scope;
    material.projectId = scope === "project" ? input.projectId ?? material.projectId : undefined;
    material.directoryId = directoryId;
    material.updatedAt = now();
    return clone(material);
  });
}

export async function deleteMaterial(id: string) {
  return mutate((store) => {
    const index = store.materials.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("资料不存在。");
    store.materials.splice(index, 1);
  });
}

/** 状态回退时解除该需求对自动整理资料的来源绑定，避免后续再次沿用失效事实。 */
export async function detachGeneratedMaterialSource(sourceRequirementCode: string) {
  return mutate((store) => {
    let changed = 0;
    for (const material of store.materials) {
      if (material.origin !== "system_generated" || !material.sourceRequirementCodes.includes(sourceRequirementCode)) continue;
      material.sourceRequirementCodes = material.sourceRequirementCodes.filter((code) => code !== sourceRequirementCode);
      material.updatedAt = now();
      changed += 1;
    }
    return changed;
  });
}

export async function upsertGeneratedMaterial(input: { projectId: string; title: string; content: string; sourceRequirementCode: string }) {
  const title = normalizeTitle(input.title);
  const content = normalizeContent(input.content);
  return mutate((store) => {
    const existing = store.materials.find((item) => item.scope === "project" && item.projectId === input.projectId && item.origin === "system_generated" && item.title === title);
    if (existing) {
      const hasSource = existing.sourceRequirementCodes.includes(input.sourceRequirementCode);
      if (existing.userManaged) {
        if (hasSource) return { material: clone(existing), changed: false };
        existing.sourceRequirementCodes = [...new Set([...existing.sourceRequirementCodes, input.sourceRequirementCode])];
        existing.updatedAt = now();
        return { material: clone(existing), changed: true };
      }
      if (existing.content === content && hasSource) return { material: clone(existing), changed: false };
      existing.content = content;
      existing.sourceRequirementCodes = [...new Set([...existing.sourceRequirementCodes, input.sourceRequirementCode])];
      existing.updatedAt = now();
      return { material: clone(existing), changed: true };
    }
    const timestamp = now();
    const material: Material = { id: `material_${randomUUID().replaceAll("-", "")}`, scope: "project", projectId: input.projectId, title, content, origin: "system_generated", sourceRequirementCodes: [input.sourceRequirementCode], createdAt: timestamp, updatedAt: timestamp };
    store.materials.push(material);
    return { material: clone(material), changed: true };
  });
}
