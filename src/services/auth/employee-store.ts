import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FeishuEmployee } from "@/services/auth/feishu-org";

const DATA_DIR = process.env.REQUIREMENT_PLATFORM_DATA_DIR
  ? path.resolve(process.env.REQUIREMENT_PLATFORM_DATA_DIR)
  : path.join(process.cwd(), "data", "requirement-platform");
const EMPLOYEE_FILE = path.join(DATA_DIR, "employees.local.json");

type StoredEmployee = {
  id: string;
  openId: string;
  unionId?: string;
  userId?: string;
  name: string;
  avatarUrl?: string;
  tenantKey?: string;
  departmentNames: string[];
  enabled: boolean;
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

async function readStore(): Promise<EmployeeStore> {
  try {
    const parsed = JSON.parse(await readFile(EMPLOYEE_FILE, "utf8")) as Partial<EmployeeStore>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.employees)) throw new Error("invalid");
    return {
      schemaVersion: 1,
      employees: parsed.employees.filter((item): item is StoredEmployee => Boolean(item?.openId && item.name)).map((item) => ({
        ...item,
        departmentNames: Array.isArray(item.departmentNames) ? item.departmentNames.filter((value): value is string => typeof value === "string") : [],
        enabled: item.enabled !== false,
        isAdmin: item.isAdmin === true,
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
  return clone(store.employees.toSorted((left, right) => Number(right.isAdmin) - Number(left.isAdmin) || left.name.localeCompare(right.name, "zh-CN")));
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
      if (isBootstrapAdmin(input.openId)) {
        existing.enabled = true;
        existing.isAdmin = true;
      }
      if (isBootstrapPublisher(input.openId)) existing.enabled = true;
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
      // 已在飞书回调中完成指定企业校验，新成员默认可用；管理员后续仍可手动停用。
      enabled: true,
      // 默认成员。管理员必须由环境变量显式指定，或由已有管理员在页面中授予。
      isAdmin: isBootstrapAdmin(input.openId),
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
        if (isBootstrapAdmin(item.openId)) { existing.enabled = true; existing.isAdmin = true; }
        if (isBootstrapPublisher(item.openId)) existing.enabled = true;
      } else {
        const employee: StoredEmployee = {
          id: `employee_${randomUUID().replaceAll("-", "")}`,
          openId: item.openId,
          name: item.name,
          avatarUrl: item.avatarUrl,
          tenantKey: item.tenantKey,
          departmentNames: item.departmentNames,
          enabled: isBootstrapAdmin(item.openId) || isBootstrapPublisher(item.openId),
          isAdmin: isBootstrapAdmin(item.openId),
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

export async function updateEmployee(openId: string, input: { enabled?: boolean; isAdmin?: boolean }) {
  return mutate((store) => {
    const target = store.employees.find((item) => item.openId === openId);
    if (!target) throw new Error("员工不存在，请先同步飞书组织架构。");
    if (input.isAdmin === false && target.isAdmin && !store.employees.some((item) => item.openId !== target.openId && item.isAdmin && item.enabled)) {
      throw new Error("至少保留一名启用中的管理员。");
    }
    if (input.enabled === false && target.isAdmin && !store.employees.some((item) => item.openId !== target.openId && item.isAdmin && item.enabled)) {
      throw new Error("不能停用最后一名管理员。");
    }
    if (input.enabled !== undefined) target.enabled = input.enabled;
    if (input.isAdmin !== undefined) target.isAdmin = input.isAdmin;
    target.updatedAt = now();
    return summary(target);
  });
}

export async function requireEnabledEmployee(openId: string) {
  const employee = await getEmployee(openId);
  if (!employee || !employee.enabled || !employee.directoryActive) throw new Error("当前飞书账号尚未获准使用需求平台，请联系管理员开通。" );
  return employee;
}

export async function requireAdminEmployee(openId: string) {
  const employee = await requireEnabledEmployee(openId);
  if (!employee.isAdmin) throw new Error("当前账号没有管理员权限。" );
  return employee;
}
