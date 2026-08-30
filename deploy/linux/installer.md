# Linux x64 一键安装包

适用于 Alibaba Cloud Linux 3、CentOS/RHEL、Rocky、AlmaLinux、Ubuntu 和 Debian 等带 systemd 的 x86_64 服务器。

安装包由 GitHub 托管 Runner 构建，服务器不执行 `npm run build`，适合 2GB 内存服务器。

## 发布安装包

在 GitHub 仓库的 **Actions → Build Linux installer → Run workflow** 中填写版本号，例如 `v0.1.0`。流程成功后会在仓库 **Releases** 中生成 `requirement-platform-linux-x64.run`。

## 服务器安装

服务器已安装 Node.js 20+、systemd 和 curl，且 `/opt/requirement-platform/.env.local` 已配置时，执行：

```bash
curl -fL --retry 3 -o /tmp/requirement-platform-linux-x64.run https://github.com/zhougepeng/requirement-platform/releases/latest/download/requirement-platform-linux-x64.run && sudo bash /tmp/requirement-platform-linux-x64.run
```

安装包会保留 `.env.local` 与 `data` 目录，并在失败时恢复上一版本。首次没有 `.env.local` 时，会只生成配置模板并停止，必须填入飞书和域名配置后重新执行。

## 每日备份与健康检查

安装成功后会创建 `requirement-platform-backup.timer`：每天 02:20 备份整个数据目录，默认保留 14 天。备份文件默认位于 `/opt/requirement-platform/backups`，不包含 `.env.local` 中的密钥。

```bash
sudo systemctl list-timers requirement-platform-backup.timer
sudo systemctl start requirement-platform-backup.service
sudo journalctl -u requirement-platform-backup.service -n 30 --no-pager
curl -fsS http://127.0.0.1:3000/api/health
```

如需修改目录或保留天数，在 `.env.local` 设置：

```ini
REQUIREMENT_PLATFORM_BACKUP_DIR=/opt/requirement-platform/backups
REQUIREMENT_PLATFORM_BACKUP_RETENTION_DAYS=14
```

本机备份无法防御整机丢失；应将备份目录定期同步到对象存储或另一台服务器。

## 暂时没有域名

飞书允许在应用安全设置中登记 `http://公网IP:3000/auth/callback`，因此可以先使用 IP 跑通扫码登录。服务器 `.env.local` 需要设置：

```ini
AUTH_MODE=feishu
APP_BASE_URL=http://公网IP:3000
FEISHU_REDIRECT_URI=http://公网IP:3000/auth/callback
AUTH_COOKIE_SECURE=false
```

`AUTH_COOKIE_SECURE=false` 只用于 HTTP IP 的短期过渡；否则浏览器不会在 HTTP 下保存登录 Cookie。不要把 `AUTH_MODE=local` 的 3000 端口直接暴露给公网：该模式会以本地管理员身份运行。取得域名和 HTTPS 后，应改用 HTTPS 地址并删除 `AUTH_COOKIE_SECURE=false`。

## 页面内更新

从包含自动更新助手的安装包开始，管理员可在左下角菜单选择“检查更新”。系统会比较当前安装包版本与 GitHub Release 的最新版本；发现新版后，点击“下载并更新”即可由服务器后台下载、安装、重启并执行原有健康检查与失败回滚。

如果服务器使用的是早期安装包，或更新前的服务配置仍启用了禁止提权的旧配置，首次仍需按上方命令手动安装一次最新版本；安装包会自动安装更新助手并刷新服务配置，之后不需要在服务器上执行 Git 命令或构建项目。
