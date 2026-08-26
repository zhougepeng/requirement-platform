# 小团队部署方式

默认不使用 Docker、PostgreSQL、Redis、MinIO、Outline 或 Keycloak。

本机和 Windows 服务器均运行一个 Node.js 进程，版本数据和 Demo 工件保存在 `data/requirement-platform/`。服务器部署时必须把此目录纳入备份，并只运行一个平台进程。

完整容器化实验配置已备份到 `archive/full-stack-20260825/`，它不是默认部署方案。
