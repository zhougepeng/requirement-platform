import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  NotificationTarget,
  ReleaseNotificationPreference,
} from "@/lib/release-notification";

const dataDir = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const preferenceFile = path.join(dataDir, "release-notification-preferences.local.json");

type StoredPreference = ReleaseNotificationPreference & {
  userId: string;
  projectId: string;
  updatedAt: string;
};
type PreferenceStore = { schemaVersion: 1; preferences: StoredPreference[] };

let mutationQueue = Promise.resolve();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cleanTargets(targets: NotificationTarget[]) {
  const seen = new Set<string>();
  return targets.flatMap((target) => {
    if (!target || !["user", "chat", "department", "all"].includes(target.kind)) {
      return [];
    }
    const id = target.id.trim();
    const name = target.name.trim();
    const key = `${target.kind}:${id}`;
    if (!id || !name || seen.has(key)) return [];
    seen.add(key);
    return [{
      id,
      name: name.slice(0, 120),
      kind: target.kind,
      departmentIdType:
        target.kind === "department" && target.departmentIdType === "open_department_id"
          ? "open_department_id"
          : target.kind === "department"
            ? "department_id"
            : undefined,
    } satisfies NotificationTarget];
  });
}

async function readStore(): Promise<PreferenceStore> {
  try {
    const value = JSON.parse(await readFile(preferenceFile, "utf8")) as Partial<PreferenceStore>;
    if (value.schemaVersion !== 1 || !Array.isArray(value.preferences)) throw new Error("invalid");
    return {
      schemaVersion: 1,
      preferences: value.preferences.flatMap((item) => {
        if (!item?.userId || !item.projectId) return [];
        return [{
          userId: item.userId,
          projectId: item.projectId,
          enabled: item.enabled !== false,
          targets: cleanTargets(Array.isArray(item.targets) ? item.targets : []),
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
        }];
      }),
    };
  } catch {
    return { schemaVersion: 1, preferences: [] };
  }
}

async function writeStore(store: PreferenceStore) {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${preferenceFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, preferenceFile);
}

async function mutate<T>(operation: (store: PreferenceStore) => T | Promise<T>) {
  const previous = mutationQueue;
  let release: () => void = () => undefined;
  mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
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

export async function getReleaseNotificationPreference(
  userId: string,
  projectId: string,
): Promise<ReleaseNotificationPreference | undefined> {
  const store = await readStore();
  const value = store.preferences.find(
    (item) => item.userId === userId && item.projectId === projectId,
  );
  return value ? clone({ enabled: value.enabled, targets: value.targets }) : undefined;
}

export async function saveReleaseNotificationPreference(
  userId: string,
  projectId: string,
  preference: ReleaseNotificationPreference,
) {
  if (!userId || !projectId) throw new Error("通知偏好缺少用户或项目。" );
  return mutate((store) => {
    const next: StoredPreference = {
      userId,
      projectId,
      enabled: preference.enabled,
      targets: cleanTargets(preference.targets),
      updatedAt: new Date().toISOString(),
    };
    const index = store.preferences.findIndex(
      (item) => item.userId === userId && item.projectId === projectId,
    );
    if (index < 0) store.preferences.push(next);
    else store.preferences[index] = next;
    return clone({ enabled: next.enabled, targets: next.targets });
  });
}
