"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

type Employee = { openId: string; name: string; departmentNames: string[]; enabled: boolean; isAdmin: boolean; directoryActive: boolean; lastLoginAt?: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json() as { data?: T; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error || "员工管理请求失败。");
  return payload.data;
}

export function EmployeeManager() {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { setEmployees(await request<Employee[]>("/api/v1/admin/employees")); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取员工目录。"); } finally { setLoading(false); }
  }
  async function sync() {
    setLoading(true); setError("");
    try { const result = await request<{ employees: Employee[] }>("/api/v1/admin/employees", { method: "POST" }); setEmployees(result.employees); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法同步飞书员工。"); } finally { setLoading(false); }
  }
  async function update(openId: string, patch: { enabled?: boolean; is_admin?: boolean }) {
    try { const result = await request<Employee>("/api/v1/admin/employees", { method: "PATCH", body: JSON.stringify({ open_id: openId, ...patch }) }); setEmployees((current) => current.map((item) => item.openId === result.openId ? result : item)); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法更新员工权限。"); }
  }

  return <div className="employee-manager-menu">
    <button className="employee-manager-trigger" title="员工与权限" aria-label="员工与权限" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}><Icon name="users" /></button>
    {menuOpen ? <><button className="employee-manager-dismiss" aria-label="关闭员工菜单" onClick={() => setMenuOpen(false)} /><div className="employee-manager-popover" role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); setOpen(true); void load(); }}><Icon name="users" /><span>员工与权限</span></button></div></> : null}
    {open ? <div className="employee-manager-layer"><button className="employee-manager-backdrop" aria-label="关闭员工管理" onClick={() => setOpen(false)} /><section className="employee-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="employee-manager-title"><header><div><h2 id="employee-manager-title">员工与权限</h2><p>同步飞书组织架构，并控制谁可以进入需求库。</p></div><button className="model-manager-close" onClick={() => setOpen(false)} aria-label="关闭员工管理"><Icon name="close" /></button></header><div className="employee-manager-body"><div className="employee-manager-toolbar"><span>{employees.length ? `已同步 ${employees.length} 名员工` : "尚未同步员工"}</span><button className="model-manager-add" disabled={loading} onClick={() => void sync()}><Icon name="refresh" />同步飞书</button></div>{error ? <p className="model-manager-error">{error}</p> : null}{loading && !employees.length ? <p className="model-manager-empty">正在读取员工目录…</p> : <div className="employee-list">{employees.map((employee) => <article className="employee-row" key={employee.openId}><div><b>{employee.name}</b><small>{employee.departmentNames.join(" / ") || "未同步部门"}</small><small>{employee.openId}</small></div><div className="employee-actions"><label><input type="checkbox" checked={employee.enabled} onChange={(event) => void update(employee.openId, { enabled: event.target.checked })} />可使用</label><label><input type="checkbox" checked={employee.isAdmin} onChange={(event) => void update(employee.openId, { is_admin: event.target.checked })} />管理员</label></div></article>)}</div>}</div></section></div> : null}
  </div>;
}
