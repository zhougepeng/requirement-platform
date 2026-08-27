"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

type EmployeeRole = "none" | "viewer" | "publisher" | "admin";
type Employee = { openId: string; name: string; departmentNames: string[]; role: EmployeeRole; directoryActive: boolean; lastLoginAt?: string };
type SyncResult = { employees: Employee[]; count: number; fetchedCount: number; departmentCount: number };

const roleLabels: Record<EmployeeRole, string> = { none: "未授权", viewer: "查看", publisher: "发布", admin: "管理" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json() as { data?: T; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "员工管理请求失败。");
  return payload.data;
}

export function EmployeeManager({ initialOpen = false, hideTrigger = false }: { initialOpen?: boolean; hideTrigger?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syncNotice, setSyncNotice] = useState("");

  useEffect(() => {
    if (!initialOpen) return;
    void load();
  }, [initialOpen]);

  async function load() {
    setLoading(true); setError("");
    try { setEmployees(await request<Employee[]>("/api/v1/admin/employees")); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取员工目录。"); } finally { setLoading(false); }
  }
  async function sync() {
    setLoading(true); setError(""); setSyncNotice("");
    try {
      const result = await request<SyncResult>("/api/v1/admin/employees", { method: "POST" });
      setEmployees(result.employees);
      setSyncNotice(result.fetchedCount <= 1
        ? `本次飞书仅返回 ${result.fetchedCount} 名可见员工（读取了 ${result.departmentCount} 个部门）。请检查飞书应用的可用范围、通讯录读取权限审批和已发布版本。`
        : `本次从飞书读取 ${result.fetchedCount} 名员工、${result.departmentCount} 个部门；已保留现有角色设置。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法同步飞书员工。"); } finally { setLoading(false); }
  }
  async function update(openId: string, role: EmployeeRole) {
    try { const result = await request<Employee>("/api/v1/admin/employees", { method: "PATCH", body: JSON.stringify({ open_id: openId, role }) }); setEmployees((current) => current.map((item) => item.openId === result.openId ? result : item)); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法更新员工权限。"); }
  }

  return <>{!hideTrigger ? <div className="employee-manager-menu">
    <button className="employee-manager-trigger" title="员工与权限" aria-label="员工与权限" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}><Icon name="users" /></button>
    {menuOpen ? <><button className="employee-manager-dismiss" aria-label="关闭员工菜单" onClick={() => setMenuOpen(false)} /><div className="employee-manager-popover" role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); setOpen(true); void load(); }}><Icon name="users" /><span>员工与权限</span></button></div></> : null}
  </div> : null}{open ? <div className="employee-manager-layer"><button className="employee-manager-backdrop" aria-label="关闭员工管理" onClick={() => setOpen(false)} /><section className="employee-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="employee-manager-title"><header><div><h2 id="employee-manager-title">员工权限</h2><p>查看可看全部需求并评论和使用 AI；发布可建项目、发布需求；管理可管理平台。</p></div><button className="model-manager-close" onClick={() => setOpen(false)} aria-label="关闭员工管理"><Icon name="close" /></button></header><div className="employee-manager-body"><div className="employee-manager-toolbar"><span>{employees.length ? `已同步 ${employees.length} 名员工` : "尚未同步员工"}</span><button className="model-manager-add" disabled={loading} onClick={() => void sync()}><Icon name="refresh" />同步飞书</button></div>{syncNotice ? <p className="employee-sync-notice">{syncNotice}</p> : null}{error ? <p className="model-manager-error">{error}</p> : null}{loading && !employees.length ? <p className="model-manager-empty">正在读取员工目录…</p> : <div className="employee-list">{employees.map((employee) => <article className="employee-row" key={employee.openId}><div><b>{employee.name}</b><small>{employee.departmentNames.join(" / ") || "未同步部门"}</small><small>{employee.directoryActive ? "在职" : "已离职"}</small></div><label className="employee-role"><span className="sr-only">{employee.name}的权限</span><select value={employee.role} onChange={(event) => void update(employee.openId, event.target.value as EmployeeRole)}>{(Object.keys(roleLabels) as EmployeeRole[]).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label></article>)}</div>}</div></section></div> : null}</>;
}
