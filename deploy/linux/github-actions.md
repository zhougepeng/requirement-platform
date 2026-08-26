# GitHub 自动部署到 Linux

该方案使用 **GitHub Actions 自托管 Runner + systemd**。Runner 在服务器本机运行，GitHub 不需要保存 SSH 密码或服务器私钥。

## 一次性准备

以下示例以 Ubuntu/Debian、部署目录 `/opt/requirement-platform/app` 为例。Node.js 请使用系统级安装的 Node.js 22 LTS，不要使用仅当前用户可见的 nvm。

1. 安装 Git、Node.js 22 LTS、curl 和反向代理软件（推荐 Caddy）。
2. 创建专用部署账号、数据目录和代码目录：

   ```bash
   sudo useradd --system --create-home --home-dir /opt/requirement-platform --shell /usr/sbin/nologin requirement-platform
   sudo mkdir -p /opt/requirement-platform/data
   sudo chown -R requirement-platform:requirement-platform /opt/requirement-platform
   sudo -u requirement-platform git clone https://github.com/zhougepeng/requirement-platform.git /opt/requirement-platform/app
   ```

3. 创建 `/opt/requirement-platform/app/.env.local`，填写飞书、域名和数据目录。该文件不进入 Git：

   ```dotenv
   AUTH_MODE=feishu
   APP_BASE_URL=https://你的域名
   AUTH_SESSION_SECRET=至少32位随机字符串
   REQUIREMENT_PLATFORM_DATA_DIR=/opt/requirement-platform/data
   REQUIREMENT_PLATFORM_PUBLISHED_DEMO_DIR=/opt/requirement-platform/data/published-demos
   ```

4. 安装 systemd 服务：

   ```bash
   sudo sed 's|__APP_ROOT__|/opt/requirement-platform/app|g' /opt/requirement-platform/app/deploy/linux/requirement-platform.service.template | sudo tee /etc/systemd/system/requirement-platform.service >/dev/null
   sudo systemctl daemon-reload
   sudo systemctl enable --now requirement-platform
   ```

5. 在 GitHub 仓库 **Settings → Actions → Runners → New self-hosted runner** 选择 Linux，按页面命令安装 Runner。Runner 使用 `requirement-platform` 账号运行，并添加标签 `requirement-platform`。
6. 仅授予该账号重启本服务的权限。在 `sudo visudo` 中加入：

   ```text
   requirement-platform ALL=(root) NOPASSWD: /bin/systemctl restart requirement-platform
   ```

7. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 设置：

   ```text
   REQUIREMENT_PLATFORM_DEPLOY_DIR = /opt/requirement-platform/app
   REQUIREMENT_PLATFORM_SYSTEMD_SERVICE = requirement-platform
   ```

8. 配置 Caddy 或 Nginx，将 HTTPS 域名反向代理到 `127.0.0.1:3000`；公网只开放 80/443，不开放 3000。

## 日常发布

每次推送 `main` 后，GitHub Actions 会检查目录干净状态，快进拉取、`npm ci`、构建、重启 systemd 服务并访问本机健康检查地址。

构建失败时不会重启旧服务。部署目录出现未提交修改时也会停止，避免覆盖服务器配置。
