import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FeishuEmployee } from "@/services/auth/feishu-org";

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const EMPLOYEE_FILE = path.join(DATA_DIR, "employees.local.json");

export type EmployeeRole = "none" | "viewer" | "publisher" | "admin";

type StoredEmployee = {
  id: string;
  openId: string;
  unionId?: string;
  userId?: string;
  name: string;
  avatarUrl?: string;
  tenantKey?: string;
  departmentNames: string[];
  role: EmployeeRole;
  /** @deprecated Kept in the file format for older deployments. Use role. */
  enabled: boolean;
  /** @deprecated Kept in the file format for older deployments. Use role. */
  isAdmin: boolean;
  directoryActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

type EmployeeStore = { schemaVersion: 1; employees: StoredEmployee[] };

export type EmployeeSummary = Omit<StoredEmployee, "id"> & { id: string };
export type EmployeeLogin = Pick<StoredEmployee, "openId" | "unionId" | "userId" | "name" | "avatarUrl" | "tenantKey">;

let mutationQueue = Promise.resolve();

function now() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai",
  }).format(new Date()).replaceAll("/", "-");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function csv(name: string) {
  return (process.env[name] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function isBootstrapAdmin(openId: string) {
  return csv("FEISHU_ADMIN_OPEN_IDS").includes(openId);
}

function isBootstrapPublisher(openId: string) {
  return csv("FEISHU_PUBLISHER_OPEN_IDS").includes(openId);
}

function roleFromLegacy(item: Partial<StoredEmployee>): EmployeeRole {
  if (item.role === "admin" || item.role === "publisher" || item.role === "viewer" || item.role === "none") return item.role;
  if (item.isAdmin === true) return "admin";
  if (item.enabled === true) return "viewer";
  return "none";
}

function legacyFlags(role: EmployeeRole) {
  return { role, enabled: role !== "none", isAdmin: role === "admin" };
}

async function readStore(): Promise<EmployeeStore> {
  try {
    const parsed = JSON.parse(await readFile(EMPLOYEE_FILE, "utf8")) as Partial<EmployeeStore>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.employees)) throw new Error("invalid");
    return {
      schemaVersion: 1,
      employees: parsed.employees.filter((item): item is StoredEmployee => Boolean(item?.openId && item.name)).map((item) => ({
        ...item,
        departmentNames: Array.isArray(item.departmentNames) ? item.departmentNames.filter((value): value is string => typeof value === "string") : [],
        ...legacyFlags(roleFromLegacy(item)),
        directoryActive: item.directoryActive !== false,
      })),
    };
  } catch {
    return { schemaVersion: 1, employees: [] };
  }
}

async function writeStore(store: EmployeeStore) {
  await mkdir(DATA_DIR, { recursive: true });
  const temporary = `${EMPLOYEE_FILE}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, EMPLOYEE_FILE);
}

async function mutate<T>(operation: (store: EmployeeStore) => T | Promise<T>) {
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

function summary(item: StoredEmployee): EmployeeSummary {
  return clone(item);
}

export async function getEmployee(openId: string) {
  const store = await readStore();
  const employee = store.employees.find((item) => item.openId === openId);
  return employee ? summary(employee) : undefined;
}

export async function listEmployees() {
  const store = await readStore();
  const rank: Record<EmployeeRole, number> = { admin: 0, publisher: 1, viewer: 2, none: 3 };
  return clone(store.employees.toSorted((left, right) => rank[left.role] - rank[right.role] || left.name.localeCompare(right.name, "zh-CN")));
}

export async function registerLoginEmployee(input: EmployeeLogin) {
  return mutate((store) => {
    const timestamp = now();
    const existing = store.employees.find((item) => item.openId === input.openId);
    if (existing) {
      Object.assign(existing, {
        name: input.name,
        unionId: input.unionId,
        userId: input.userId,
        avatarUrl: input.avatarUrl,
        tenantKey: input.tenantKey,
        directoryActive: true,
        updatedAt: timestamp,
        lastLoginAt: timestamp,
      });
      if (isBootstrapAdmin(input.openId)) Object.assign(existing, legacyFlags("admin"));
      else if (isBootstrapPublisher(input.openId) && existing.role === "none") Object.assign(existing, legacyFlags("publisher"));
      return summary(existing);
    }
    const employee: StoredEmployee = {
      id: `employee_${randomUUID().replaceAll("-", "")}`,
      openId: input.openId,
      unionId: input.unionId,
      userId: input.userId,
      name: input.name,
      avatarUrl: input.avatarUrl,
      tenantKey: input.tenantKey,
      departmentNames: [],
      // 新登录员工默认未授权，由管理员在员工管理中授予角色。
      ...legacyFlags(isBootstrapAdmin(input.openId) ? "admin" : isBootstrapPublisher(input.openId) ? "publisher" : "none"),
      directoryActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLoginAt: timestamp,
    };
    store.employees.push(employee);
    return summary(employee);
  });
}

export async function syncEmployees(items: FeishuEmployee[]) {
  return mutate((store) => {
    const timestamp = now();
    const byOpenId = new Map(store.employees.map((item) => [item.openId, item]));
    for (const item of items) {
      const existing = byOpenId.get(item.openId);
      if (existing) {
        Object.assign(existing, { name: item.name, avatarUrl: item.avatarUrl, tenantKey: item.tenantKey, departmentNames: item.departmentNames, directoryActive: item.directoryActive, updatedAt: timestamp });
        if (isBootstrapAdmin(item.openId)) Object.assign(existing, legacyFlags("admin"));
        else if (isBootstrapPublisher(item.openId) && existing.role === "none") Object.assign(existing, legacyFlags("publisher"));
      } else {
        const employee: StoredEmployee = {
          id: `employee_${randomUUID().replaceAll("-", "")}`,
          openId: item.openId,
          name: item.name,
          avatarUrl: item.avatarUrl,
          tenantKey: item.tenantKey,
          departmentNames: item.departmentNames,
          ...legacyFlags(isBootstrapAdmin(item.openId) ? "admin" : isBootstrapPublisher(item.openId) ? "publisher" : "none"),
          directoryActive: item.directoryActive,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        store.employees.push(employee);
      }
    }
    return clone(store.employees);
  });
}

export async function updateEmployee(openId: string, input: { role: EmployeeRole }) {
  return mutate((store) => {
    const target = store.employees.find((item) => item.openId === openId);
    if (!target) throw new Error("员工不存在，请先同步飞书组织架构。");
    if (target.role === "admin" && input.role !== "admin" && !store.employees.some((item) => item.openId !== target.openId && item.role === "admin" && item.directoryActive)) {
      throw new Error("至少保留一名有效管理员。");
    }
    Object.assign(target, legacyFlags(input.role));
    target.updatedAt = now();
    return summary(target);
  });
}

export async function requireViewerEmployee(openId: string) {
  const employee = await getEmployee(openId);
  if (!employee || employee.role === "none" || !employee.directoryActive) throw new Error("当前飞书账号尚未获准使用需求平台，请联系管理员开通。" );
  return employee;
}

/** @deprecated Use requireViewerEmployee. */
export const requireEnabledEmployee = requireViewerEmployee;

export async function requirePublisherEmployee(openId: string) {
  const employee = await requireViewerEmployee(openId);
  if (employee.role !== "publisher" && employee.role !== "admin") throw new Error("当前账号没有发布权限。" );
  return employee;
}

export async function requireAdminEmployee(openId: string) {
  const employee = await requireViewerEmployee(openId);
  if (employee.role !== "admin") throw new Error("当前账号没有管理员权限。" );
  return employee;
}
