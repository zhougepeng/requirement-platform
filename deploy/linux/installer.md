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

## 页面内更新

从包含自动更新助手的安装包开始，管理员可在左下角菜单选择“检查更新”。系统会比较当前安装包版本与 GitHub Release 的最新版本；发现新版后，点击“下载并更新”即可由服务器后台下载、安装、重启并执行原有健康检查与失败回滚。

如果服务器使用的是早期安装包，首次仍需按上方命令手动安装一次最新版本；新安装包会自动配置受控更新助手，之后不需要在服务器上执行 Git 命令或构建项目。
