# GitHub 自动部署到 Linux

该方案使用 **GitHub Actions 自托管 Runner + systemd**。Runner 在服务器本机运行，GitHub 不需要保存 SSH 密码或服务器私钥。

## 一次性准备

以下示例以 Ubuntu/Debian、部署目录 `/opt/requirement-platform/app` 为例。Node.js 请使用系统级安装的 Node.js 22 LTS，不要使用仅当前用户可见的 nvm。

1. 安装 Git、Node.js 22 LTS、curl 和反向代理软件（推荐 Caddy）。
2. 创建专用部署账号、数据目录和发布目录：

   ```bash
   sudo useradd --system --create-home --home-dir /opt/requirement-platform --shell /usr/sbin/nologin requirement-platform
   sudo mkdir -p /opt/requirement-platform/data
   sudo chown -R requirement-platform:requirement-platform /opt/requirement-platform
   ```

3. 创建 `/opt/requirement-platform/.env.local`，填写飞书、域名和数据目录。该文件不进入 Git：

   ```dotenv
   AUTH_MODE=feishu
   APP_BASE_URL=https://你的域名
   AUTH_SESSION_SECRET=至少32位随机字符串
   REQUIREMENT_PLATFORM_DATA_DIR=/opt/requirement-platform/data
   REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR=/opt/requirement-platform/data/published-demos
   ```

4. 安装 systemd 服务：

   ```bash
   sudo sed 's|__PLATFORM_ROOT__|/opt/requirement-platform|g' /opt/requirement-platform/deploy/linux/requirement-platform.service.template | sudo tee /etc/systemd/system/requirement-platform.service >/dev/null
   sudo systemctl daemon-reload
   sudo systemctl enable requirement-platform
   ```

5. 在 GitHub 仓库 **Settings → Actions → Runners → New self-hosted runner** 选择 Linux，按页面命令安装 Runner。Runner 使用 `requirement-platform` 账号运行，并添加标签 `requirement-platform`。
6. 仅授予该账号重启本服务的权限。在 `sudo visudo` 中加入：

   ```text
   # 先运行 command -v systemctl，并把输出的真实路径填入下面一行。
   requirement-platform ALL=(root) NOPASSWD: /usr/bin/systemctl restart requirement-platform
   ```

7. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 设置：

   ```text
   REQUIREMENT_PLATFORM_DEPLOY_DIR = /opt/requirement-platform
   REQUIREMENT_PLATFORM_SYSTEMD_SERVICE = requirement-platform
   ```

8. 配置 Caddy 或 Nginx，将 HTTPS 域名反向代理到 `127.0.0.1:3000`；公网只开放 80/443，不开放 3000。

## 日常发布

每次推送 `main` 后，GitHub 托管 Runner 会完成 `npm ci` 与构建；服务器 Runner 只下载包含 `.next/static` 与 `public` 的 `.next/standalone` 产物，切换到新版本后重启 systemd 并检查本机地址。服务器不再执行 `npm run build`。

构建失败时不会触发服务器部署。新版本启动或健康检查失败时，脚本会恢复到上一个可用版本。

如不想安装自托管 Runner，也可使用 [Linux x64 一键安装包](installer.md)。
