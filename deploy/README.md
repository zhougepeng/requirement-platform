# 小团队部署方式

默认不使用 Docker、PostgreSQL、Redis、MinIO、Outline 或 Keycloak。

本机、Windows 和 Linux 服务器均运行一个 Node.js 进程，版本数据和 Demo 工件保存在独立数据目录。服务器部署时必须把该目录纳入备份，并只运行一个平台进程。

- Windows：见 [Windows 服务器部署](windows-server.md) 与 [GitHub 自动部署](windows/github-actions.md)。
- Linux：可使用 [GitHub 自动部署](linux/github-actions.md)，或下载 [Linux x64 一键安装包](linux/installer.md)。

完整容器化实验配置已备份到 `archive/full-stack-20260825/`，它不是默认部署方案。
