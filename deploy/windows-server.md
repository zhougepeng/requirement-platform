# Windows 服务器部署

## 目标

一台 Windows 服务器运行一个需求平台进程。外网通过 HTTPS 域名访问；Node 服务只监听本机 `127.0.0.1`，不直接暴露 3000 端口。

## 首次部署

1. 安装 Node.js 22 LTS，并将项目放到例如 `D:\RequirementPlatform\app`。
2. 在项目目录执行 `npm ci`、`npm run build`。
3. 创建 `D:\RequirementPlatform\data`，复制 `.env.local.example` 为项目根目录 `.env.local`，至少设置：

   ```dotenv
   AUTH_MODE=feishu
   APP_BASE_URL=https://你的域名
   AUTH_SESSION_SECRET=至少32位随机字符串
   FEISHU_APP_ID=cli_xxx
   FEISHU_APP_SECRET=飞书应用密钥
   FEISHU_ALLOWED_TENANT_KEY=你的租户key
   # 可选：首次扫码默认普通成员；如需管理员，请明确填写 open_id
   FEISHU_ADMIN_OPEN_IDS=首位管理员的open_id
   FEISHU_PUBLISHER_OPEN_IDS=产品经理的open_id
   MCP_API_TOKEN=独立且足够长的随机令牌
   REQUIREMENT_PLATFORM_DATA_DIR=D:/RequirementPlatform/data
   REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR=D:/RequirementPlatform/data/published-demos
   ```

4. 在飞书开放平台把 `https://你的域名/auth/callback` 配为网页应用重定向地址，并申请网页应用登录、用户基本信息和通讯录读取权限；通讯录应用可见范围设为全员。
5. 启动服务：`npm run start:local`。验证 `http://127.0.0.1:3000` 可打开。
6. 使用 IIS 或 Caddy 将 HTTPS 域名反向代理到 `http://127.0.0.1:3000`。公网防火墙只开放 443，不开放 3000。

## 运行与备份

- 用 Windows 任务计划程序或受控服务账户保持 `npm run start:local` 常驻；服务账户须对 `D:\RequirementPlatform\data` 有读写权限。
- 每日备份整个 `D:\RequirementPlatform\data` 目录。它包含版本元数据、Demo 原始工件和已发布 Demo，缺少其中任何一项都不能完整恢复。
- 升级代码前先备份数据目录；升级只替换应用目录，不替换数据目录。

## GitHub 自动部署

推荐在 Windows 服务器安装 GitHub Actions 自托管 Runner。每次推送 `main` 后，服务器会安全拉取代码、构建并重启本机服务；不需要向 GitHub 保存远程桌面或 SSH 登录信息。

完整操作见 [GitHub 自动部署说明](windows/github-actions.md)。

## 验收

1. 未登录打开域名会跳转飞书登录；开发模式页面底部也可随时点击“飞书登录”进入授权。
2. 首次登录的员工会登记为普通成员；通过 `FEISHU_ADMIN_OPEN_IDS` 指定的账号才会成为启动管理员，之后管理员可在“员工与权限”中设置其他管理员。
3. 未被管理员启用的员工不能读取项目、需求、Demo 或使用 AI。
4. 管理员在左侧底部“员工与权限”中同步飞书组织架构，并逐个启用员工或设置管理员。
5. 普通启用员工能查看 PRD、Demo、评论和使用 AI；只有发布者白名单中的启用员工能上传和发布。
6. MCP 无令牌返回 401，携带令牌可调用发布工具；MCP 令牌只交给受控自动化服务。
