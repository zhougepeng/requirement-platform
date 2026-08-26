# GitHub 自动部署到 Windows

该方案使用 **GitHub Actions 自托管 Runner**。Runner 运行在你的 Windows 服务器上，因此 GitHub 不需要保存远程桌面、SSH 或 SMB 登录凭据。

## 一次性准备

1. 在服务器安装 Node.js 22 LTS 和 Git。
2. 以部署账号创建目录，例如：

   ```powershell
   mkdir D:\RequirementPlatform
   git clone https://github.com/zhougepeng/requirement-platform.git D:\RequirementPlatform\app
   cd D:\RequirementPlatform\app
   copy .env.local.example .env.local
   npm ci
   npm run build
   ```

3. 编辑 `D:\RequirementPlatform\app\.env.local`，填写飞书、数据目录和域名配置。数据目录必须在 `D:\RequirementPlatform\data` 这类应用目录之外。
4. 在 GitHub 仓库 **Settings → Actions → Runners → New self-hosted runner**，选择 Windows。按 GitHub 页面显示的命令安装；安装时添加标签 `requirement-platform`，并以 Windows 服务方式运行 Runner。
5. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 新建变量：

   ```text
   REQUIREMENT_PLATFORM_DEPLOY_DIR = D:\RequirementPlatform\app
   ```

6. 配置 IIS 或 Caddy：公网仅开放 HTTPS 443，反向代理到 `http://127.0.0.1:3000`。不要将 3000 直接暴露到公网。

## 日常发布

推送到 `main` 后，GitHub Actions 会自动：

1. 检查部署目录是否干净；
2. 快进拉取 GitHub 代码；
3. 安装依赖并构建；
4. 重启本机 Node 服务；
5. 访问 `127.0.0.1:3000` 健康检查。

构建失败时，脚本会在重启前停止，旧服务继续运行。部署目录存在未提交修改时会拒绝拉取，避免覆盖 `.env.local` 以外的人工改动。

## 首次启动

首次没有 PID 文件时，可以在服务器执行：

```powershell
cd D:\RequirementPlatform\app
.\deploy\windows\restart-platform.ps1
```

后续由 GitHub Actions 自动处理。服务器重启后的自动拉起可使用 Windows 任务计划程序，任务动作填写：

```text
powershell.exe -ExecutionPolicy Bypass -File D:\RequirementPlatform\app\deploy\windows\restart-platform.ps1
```
