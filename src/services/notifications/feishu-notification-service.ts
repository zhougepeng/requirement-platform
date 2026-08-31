import "server-only";

import type { NotificationTarget } from "@/lib/release-notification";
import { listEmployees } from "@/services/auth/employee-store";
import { FeishuLoginError, getTenantAccessToken } from "@/services/auth/feishu-auth";
import {
  fetchFeishuEmployees,
  listFeishuDepartmentMemberOpenIds,
  listFeishuNotificationDepartments,
} from "@/services/auth/feishu-org";

const API = "https://open.feishu.cn/open-apis";

type FeishuEnvelope<T> = { code?: number; msg?: string; data?: T };
export type NotificationTargetOption = NotificationTarget;
export type NotificationTargetCatalog = { targets: NotificationTargetOption[]; warnings: string[] };

export class FeishuNotificationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readableError(payload: FeishuEnvelope<unknown>, status: number) {
  return `飞书通知发送失败（${payload.code ?? status}${payload.msg ? `：${payload.msg}` : ""}）。`;
}

function readableTargetError(payload: FeishuEnvelope<unknown>, status: number) {
  if (payload.code === 99991672) {
    return "飞书应用未开通群聊读取权限；可在开放平台开通 im:chat:readonly 后重试，也可改选人员、部门或全员。";
  }
  return `飞书群聊读取失败（${payload.code ?? status}${payload.msg ? `：${payload.msg}` : ""}）。`;
}

function readableCatalogFailure(error: unknown) {
  if (error instanceof FeishuLoginError && error.kind === "configuration")
    return "飞书消息服务尚未配置：请在运行服务的 .env.local 中填写 FEISHU_APP_ID 和 FEISHU_APP_SECRET 后重启服务。";
  return error instanceof Error ? error.message : "飞书数据读取失败。";
}

async function sendText(token: string, receiveIdType: "open_id" | "chat_id", receiveId: string, content: string) {
  let response: Response;
  try {
    response = await fetch(`${API}/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ receive_id: receiveId, msg_type: "text", content: JSON.stringify({ text: content }) }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "网络连接失败";
    throw new FeishuNotificationError(`无法连接飞书消息服务：${reason.slice(0, 160)}`);
  }
  const payload = await response.json().catch(() => ({})) as FeishuEnvelope<unknown>;
  if (!response.ok || payload.code !== 0) throw new FeishuNotificationError(readableError(payload, response.status));
}

async function chatTargets(token: string): Promise<NotificationTargetOption[]> {
  const result: NotificationTargetOption[] = [];
  let pageToken = "";
  do {
    const url = new URL(`${API}/im/v1/chats`);
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({})) as FeishuEnvelope<{ items?: Array<{ chat_id?: string; name?: string }>; has_more?: boolean; page_token?: string }>;
    if (!response.ok || payload.code !== 0) throw new FeishuNotificationError(readableTargetError(payload, response.status));
    for (const item of payload.data?.items ?? []) {
      if (item.chat_id && item.name) result.push({ id: item.chat_id, kind: "chat", name: item.name });
    }
    pageToken = payload.data?.has_more ? payload.data.page_token ?? "" : "";
  } while (pageToken);
  return result;
}

export async function listFeishuNotificationTargets(): Promise<NotificationTargetCatalog> {
  const employees = await listEmployees();
  const users = employees
    .filter((employee) => employee.directoryActive)
    .map((employee) => ({ id: employee.openId, kind: "user" as const, name: employee.name }));
  const baseTargets: NotificationTargetOption[] = [
    { id: "all", kind: "all", name: "全员" },
    ...users,
  ];
  const warnings: string[] = [];
  const departments = await listFeishuNotificationDepartments().catch((error) => {
    warnings.push(`部门暂不可选：${readableCatalogFailure(error)}`);
    return [];
  });
  let chats: NotificationTargetOption[] = [];
  try {
    chats = await chatTargets(await getTenantAccessToken());
  } catch (error) {
    warnings.push(`群聊暂不可选：${readableCatalogFailure(error)}`);
  }
  return {
    targets: [
      ...baseTargets,
      ...departments.map((department) => ({ id: department.id, kind: "department" as const, name: department.path.join(" / "), departmentIdType: department.idType })),
      ...chats,
    ],
    warnings,
  };
}

export class FeishuNotificationService {
  async sendToUser(openId: string, content: string) {
    const token = await getTenantAccessToken();
    await sendText(token, "open_id", openId, content);
    return 1;
  }

  async sendToChat(chatId: string, content: string) {
    const token = await getTenantAccessToken();
    await sendText(token, "chat_id", chatId, content);
    return 1;
  }

  async sendToDepartment(departmentId: string, idType: "department_id" | "open_department_id", content: string) {
    const openIds = await listFeishuDepartmentMemberOpenIds(departmentId, idType);
    return this.sendToUsers(openIds, content);
  }

  async sendToAll(content: string) {
    const snapshot = await fetchFeishuEmployees();
    return this.sendToUsers(snapshot.employees.filter((employee) => employee.directoryActive).map((employee) => employee.openId), content);
  }

  private async sendToUsers(openIds: string[], content: string) {
    const token = await getTenantAccessToken();
    const uniqueIds = Array.from(new Set(openIds));
    let deliveredCount = 0;
    const failures: string[] = [];
    for (const openId of uniqueIds) {
      try {
        await sendText(token, "open_id", openId, content);
        deliveredCount += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "飞书发送失败");
      }
    }
    if (failures.length) throw new FeishuNotificationError(`已向 ${deliveredCount} 位对象发送，但 ${failures.length} 位发送失败：${failures[0]}`);
    return deliveredCount;
  }

  async send(targets: NotificationTarget[], content: string) {
    const cleaned = content.trim();
    if (!cleaned) throw new FeishuNotificationError("通知内容不能为空。", 400);
    if (!targets.length) throw new FeishuNotificationError("请至少选择一个通知对象。", 400);
    const recipientOpenIds = new Set<string>();
    const chats = new Set<string>();
    for (const target of targets) {
      if (target.kind === "user") recipientOpenIds.add(target.id);
      if (target.kind === "chat") chats.add(target.id);
      if (target.kind === "department") {
        for (const openId of await listFeishuDepartmentMemberOpenIds(target.id, target.departmentIdType ?? "department_id")) recipientOpenIds.add(openId);
      }
      if (target.kind === "all") {
        const snapshot = await fetchFeishuEmployees();
        for (const employee of snapshot.employees) if (employee.directoryActive) recipientOpenIds.add(employee.openId);
      }
    }
    let deliveredCount = await this.sendToUsers([...recipientOpenIds], cleaned);
    for (const chatId of chats) deliveredCount += await this.sendToChat(chatId, cleaned);
    return { deliveredCount };
  }
}

export const feishuNotificationService = new FeishuNotificationService();
