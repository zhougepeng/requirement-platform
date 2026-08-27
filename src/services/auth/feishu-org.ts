import "server-only";

import { getTenantAccessToken } from "@/services/auth/feishu-auth";

const API = "https://open.feishu.cn/open-apis";
const PAGE_SIZE = "50";
const MAX_ITEMS = 10_000;

type Envelope<T> = { code?: number; msg?: string; data?: T };
type Page<T> = { items?: T[]; has_more?: boolean; page_token?: string };
type DepartmentIdType = "open_department_id" | "department_id";
type Department = { open_department_id?: string; department_id?: string; name?: string };
type DepartmentNode = { id: string; idType: DepartmentIdType; name: string; path: string[] };
type ContactScope = { authed_departments?: Array<{ open_department_id?: string; department_id?: string; department_id_type?: string; name?: string }> };
type User = { open_id?: string; user_id?: string; name?: string; avatar?: { avatar_origin?: string; avatar_72?: string }; avatar_url?: string; tenant_key?: string; status?: { is_active?: boolean }; active?: boolean };

export type FeishuEmployee = { openId: string; name: string; avatarUrl?: string; tenantKey?: string; departmentNames: string[]; directoryActive: boolean };
export type FeishuDirectorySnapshot = {
  employees: FeishuEmployee[];
  /** 部门数包含根节点，用于在管理界面解释本次同步的可见范围。 */
  departmentCount: number;
};

async function fetchPage<T>(url: URL, token: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json() as Envelope<Page<T>>;
  if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(`飞书通讯录请求失败：${payload.code ?? response.status}${payload.msg ? `，${payload.msg}` : ""}`);
  return payload.data;
}

async function fetchContactScopeRoots(token: string) {
  const response = await fetch(`${API}/contact/v3/scopes`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json() as Envelope<ContactScope>;
  if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(`飞书通讯录授权范围读取失败：${payload.code ?? response.status}${payload.msg ? `，${payload.msg}` : ""}`);
  return (payload.data.authed_departments ?? []).flatMap((department) => {
    const id = department.open_department_id ?? department.department_id;
    if (!id) return [];
    // 飞书根节点 0 及部分旧租户会返回普通 department_id；不能把它当作 open_department_id。
    const idType: DepartmentIdType =
      department.department_id_type === "department_id" || (!department.open_department_id && Boolean(department.department_id))
        ? "department_id"
        : "open_department_id";
    return [{ id, idType, name: department.name || "已授权部门" }];
  });
}

async function listDirectChildren(token: string, departmentId: string, departmentIdType: DepartmentIdType) {
  const result: Array<{ id: string; name: string }> = [];
  let pageToken = "";
  do {
    const url = new URL(`${API}/contact/v3/departments/${encodeURIComponent(departmentId)}/children`);
    url.searchParams.set("department_id_type", departmentIdType);
    url.searchParams.set("page_size", PAGE_SIZE);
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const page = await fetchPage<Department>(url, token);
    for (const item of page.items ?? []) {
      const id = item.open_department_id ?? item.department_id;
      if (!id || !item.name) continue;
      result.push({ id, name: item.name });
      if (result.length >= MAX_ITEMS) throw new Error("飞书组织架构超过 10000 个部门，已停止同步。");
    }
    pageToken = page.has_more ? page.page_token ?? "" : "";
  } while (pageToken);
  return result;
}

async function listDepartmentUsers(token: string, departmentId: string, departmentIdType: DepartmentIdType) {
  const users: User[] = [];
  let pageToken = "";
  do {
    const url = new URL(`${API}/contact/v3/users/find_by_department`);
    url.searchParams.set("department_id", departmentId);
    url.searchParams.set("department_id_type", departmentIdType);
    url.searchParams.set("user_id_type", "open_id");
    url.searchParams.set("contain_child", "false");
    url.searchParams.set("page_size", PAGE_SIZE);
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const page = await fetchPage<User>(url, token);
    users.push(...(page.items ?? []));
    if (users.length >= MAX_ITEMS) throw new Error("飞书组织架构超过 10000 名员工，已停止同步。");
    pageToken = page.has_more ? page.page_token ?? "" : "";
  } while (pageToken);
  return users;
}

/** Reads the app-visible Feishu directory and returns one record per employee. */
export async function fetchFeishuEmployees() {
  const token = await getTenantAccessToken();
  // 部分通讯录授权时从根部门 0 往下查，飞书可能不会返回被授权部门；先读取应用实际授权范围。
  const authorizedRoots = await fetchContactScopeRoots(token);
  // 没有显式根部门时，飞书租户根节点 0 必须按普通 department_id 请求。
  const departments: DepartmentNode[] = (authorizedRoots.length ? authorizedRoots : [{ id: "0", idType: "department_id" as const, name: "组织架构" }]).map((department) => ({ ...department, path: [department.name] }));
  for (let index = 0; index < departments.length; index += 1) {
    const parent = departments[index];
    for (const child of await listDirectChildren(token, parent.id, parent.idType)) {
      departments.push({ ...child, idType: "open_department_id", path: [...parent.path, child.name] });
    }
    if (departments.length > MAX_ITEMS) throw new Error("飞书组织架构超过 10000 个部门，已停止同步。");
  }
  const usersById = new Map<string, FeishuEmployee>();
  for (const department of departments) {
    for (const user of await listDepartmentUsers(token, department.id, department.idType)) {
      const openId = user.open_id ?? user.user_id;
      if (!openId || !user.name) continue;
      const existing = usersById.get(openId);
      const departmentNames = Array.from(new Set([...(existing?.departmentNames ?? []), ...department.path]));
      usersById.set(openId, {
        openId,
        name: user.name,
        avatarUrl: user.avatar_url ?? user.avatar?.avatar_origin ?? user.avatar?.avatar_72,
        tenantKey: user.tenant_key,
        departmentNames,
        directoryActive: user.active !== false && user.status?.is_active !== false,
      });
    }
  }
  return {
    employees: Array.from(usersById.values()),
    departmentCount: departments.length,
  } satisfies FeishuDirectorySnapshot;
}
