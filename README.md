# 需求管理平台

独立的产品需求发布、版本查看、Demo 预览和版本讨论平台。

面向小团队：一个本机 Node.js 服务即可完成 Demo 上传、PRD 发布、历史查看、评论和 MCP 自动化发布。

## 本地启动

```powershell
npm install
npm run build
npm run start:local
```

打开 `http://127.0.0.1:3000/`，或使用永久版本链接：

```text
/r/ERP-001
/r/ERP-001?v=1
```

开发阶段默认使用本地管理员身份，不需要填写 `FEISHU_ADMIN_OPEN_IDS`。左侧底部设置可以直接打开“员工与权限”和“模型管理”；用户菜单中的“飞书登录”用于在已配置飞书应用时切换到真实组织权限模式。

## 发布 API

1. `POST /api/v1/artifacts`，以 multipart `file` 上传根目录包含 `index.html` 的 `demo.zip`。
2. `POST /api/v1/requirements/publish`，传入 `project_code`、`requirement_code`、`title`、`prd_markdown`、`artifact_id`、`change_summary`。

## 外网服务器

复制 `.env.local.example` 为 `.env.local`，填写飞书登录配置和数据目录。首次部署可用 `FEISHU_ADMIN_OPEN_IDS` 指定至少一名启动管理员；其他员工登录后由管理员在“员工与权限”中选择“查看”“发布”或“管理”。平台不做项目级或需求级权限隔离，拥有“查看”及以上角色即可看到全部项目和需求。平台本身只监听 `127.0.0.1`，通过 IIS 或 Caddy 提供 HTTPS 域名访问。

Windows 与 Linux 均可通过 GitHub Actions 自托管 Runner 自动部署；Windows 使用受控 Node 进程，Linux 使用 systemd。Linux 一键安装包会启用每日数据备份定时器，默认保留 14 天；备份目录仍应同步到对象存储或另一台机器。详见 [当前实施状态](docs/implementation-status.md) 与 [部署说明](deploy/README.md)。
