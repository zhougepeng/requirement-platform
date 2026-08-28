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
  /** 用于解释飞书返回的可见范围，不包含任何凭据或用户隐私信息。 */
  diagnostics: { scopeRootCount: number; discoveredDepartmentCount: number; fallbackDepartmentCount: number };
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
      department.department_id_type === "department_id" || id === "0" || (!department.open_department_id && Boolean(department.department_id))
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
      const id = departmentIdType === "department_id"
        ? item.department_id ?? item.open_department_id
        : item.open_department_id ?? item.department_id;
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

function departmentNodeFromApi(item: Department, path: string[]): DepartmentNode | undefined {
  // API 会同时返回两种 ID 的租户中，优先使用普通 department_id；根节点 0 也只能按该类型请求。
  if (item.department_id) return { id: item.department_id, idType: "department_id", name: item.name || "未命名部门", path };
  if (item.open_department_id) return { id: item.open_department_id, idType: "open_department_id", name: item.name || "未命名部门", path };
  return undefined;
}

/**
 * 飞书允许在不提供父部门时，按应用实际可见范围返回授权部门和其下级部门。
 * 有些租户的 scopes 接口只会给根节点，这条路径作为“根节点递归查询”的兜底。
 */
async function listVisibleDepartments(token: string) {
  const departments: DepartmentNode[] = [];
  let pageToken = "";
  do {
    const url = new URL(`${API}/contact/v3/departments`);
    url.searchParams.set("department_id_type", "department_id");
    url.searchParams.set("fetch_child", "true");
    url.searchParams.set("page_size", PAGE_SIZE);
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const page = await fetchPage<Department>(url, token);
    for (const item of page.items ?? []) {
      const node = departmentNodeFromApi(item, [item.name || "已授权部门"]);
      if (node) departments.push(node);
      if (departments.length > MAX_ITEMS) throw new Error("飞书组织架构超过 10000 个部门，已停止同步。");
    }
    pageToken = page.has_more ? page.page_token ?? "" : "";
  } while (pageToken);
  return departments;
}

function addUser(usersById: Map<string, FeishuEmployee>, user: User, departmentPath: string[]) {
  const openId = user.open_id ?? user.user_id;
  if (!openId || !user.name) return;
  const existing = usersById.get(openId);
  const departmentNames = Array.from(new Set([...(existing?.departmentNames ?? []), ...departmentPath]));
  usersById.set(openId, {
    openId,
    name: user.name,
    avatarUrl: user.avatar_url ?? user.avatar?.avatar_origin ?? user.avatar?.avatar_72,
    tenantKey: user.tenant_key,
    departmentNames,
    directoryActive: user.active !== false && user.status?.is_active !== false,
  });
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
      departments.push({ ...child, idType: parent.idType, path: [...parent.path, child.name] });
    }
    if (departments.length > MAX_ITEMS) throw new Error("飞书组织架构超过 10000 个部门，已停止同步。");
  }
  const usersById = new Map<string, FeishuEmployee>();
  for (const department of departments) {
    for (const user of await listDepartmentUsers(token, department.id, department.idType)) {
      addUser(usersById, user, department.path);
    }
  }
  let fallbackDepartmentCount = 0;
  // 当 scopes 仅返回根节点时，即使根节点有少量直属员工，也不能据此认定没有下级员工。
  // 使用“授权部门列表”接口继续读取，避免只同步到当前管理员这类不完整目录。
  // 这不会扩大飞书实际授权范围，接口本身仍会按应用的通讯录数据范围过滤。
  if (usersById.size === 0 || departments.length <= authorizedRoots.length || (authorizedRoots.length === 0 && departments.length === 1)) {
    try {
      const visibleDepartments = await listVisibleDepartments(token);
      const knownDepartments = new Set(departments.map((item) => `${item.idType}:${item.id}`));
      const fallbackDepartments = visibleDepartments.filter((item) => !knownDepartments.has(`${item.idType}:${item.id}`));
      fallbackDepartmentCount = fallbackDepartments.length;
      for (const department of fallbackDepartments) {
        for (const user of await listDepartmentUsers(token, department.id, department.idType)) {
          addUser(usersById, user, department.path);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "未知错误";
      console.warn(`[feishu-org] fallback department lookup failed: ${reason}`);
    }
  }
  console.info(`[feishu-org] scopes=${authorizedRoots.length} departments=${departments.length} fallback_departments=${fallbackDepartmentCount} employees=${usersById.size}`);
  return {
    employees: Array.from(usersById.values()),
    departmentCount: departments.length + fallbackDepartmentCount,
    diagnostics: {
      scopeRootCount: authorizedRoots.length,
      discoveredDepartmentCount: departments.length,
      fallbackDepartmentCount,
    },
  } satisfies FeishuDirectorySnapshot;
}
