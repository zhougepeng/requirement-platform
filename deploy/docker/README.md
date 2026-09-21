# Docker 镜像部署与页面更新

这套方式由 GitHub Actions 在 GitHub 托管 Runner 上构建并发布 GHCR 镜像，服务器不安装 GitHub 自托管 Runner，也不在服务器执行 `npm install` 或 `npm run build`。

## 发布镜像

工作流文件是 `.github/workflows/publish-docker.yml`。

- Release 发布时自动构建：`ghcr.io/zhougepeng/requirement-platform:<tag>` 和 `:latest`。
- 也可以在 GitHub 的 **Actions → Publish Docker image → Run workflow** 中填写镜像版本，例如 `v0.3.36`。如果该 tag 已存在，使用该 tag 的源码；如果 tag 尚未存在，手动运行会使用当前 `main` 构建。
- Release 发布时使用 Release tag 的源码；Dockerfile 和 `.dockerignore` 使用 `main` 中的构建定义。正式生产版本建议先创建并发布对应 Release。

GHCR 镜像如果设为 private，服务器必须预先执行一次只读登录，例如使用只有 `read:packages` 权限的 PAT：

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
```

不要把 PAT 写进仓库、Compose 文件、网页环境变量或截图。

## 一次性部署

将本目录的 `docker-compose.yml` 和服务器的 `.env.local` 放到同一个目录，并创建持久化数据目录。Compose 文件把数据挂载到 `/app/data`，所以替换容器不会删除需求、工件和发布 Demo。

应用容器使用 UID 1001 运行，首次创建宿主机数据目录后需要授予该 UID 写权限：

```bash
sudo mkdir -p /opt/requirement-platform/data
sudo chown -R 1001:1001 /opt/requirement-platform/data
sudo cp deploy/docker/docker-compose.yml /opt/requirement-platform/docker-compose.yml
sudo cp .env.local /opt/requirement-platform/.env.local
cd /opt/requirement-platform
REQUIREMENT_PLATFORM_DOCKER_VERSION=v0.3.35 docker compose pull
REQUIREMENT_PLATFORM_DOCKER_VERSION=v0.3.35 docker compose up -d
```

配置重点：

```dotenv
REQUIREMENT_PLATFORM_DOCKER_IMAGE=ghcr.io/zhougepeng/requirement-platform
REQUIREMENT_PLATFORM_DOCKER_UPDATE_ENABLED=true
REQUIREMENT_PLATFORM_DATA_DIR=/app/data/requirement-platform
```

生产环境的 `APP_VERSION` 应始终使用实际镜像 tag，不要使用 `latest` 作为版本标识，否则页面无法可靠判断是否有更新。

## 接入“系统更新”页面

页面运行在容器内，不能直接操作宿主机 Docker。需要在宿主机安装一次 root 运行的更新桥接服务：

```bash
sudo install -m 750 deploy/docker/requirement-platform-docker-updater /usr/local/sbin/requirement-platform-docker-updater
sudo install -d -m 755 /etc/requirement-platform
sudo cp deploy/docker/docker-updater.env.example /etc/requirement-platform/docker-updater.env
sudo cp deploy/docker/requirement-platform-docker-updater.service.template /etc/systemd/system/requirement-platform-docker-updater.service
sudo systemctl daemon-reload
sudo systemctl enable --now requirement-platform-docker-updater.service
```

确保宿主机变量中的 `PROJECT_DIR`、Compose 文件、数据目录和容器名与实际部署一致。更新桥接只接受 `v...` 版本号，固定使用配置中的镜像仓库，拉取后健康检查失败会尝试恢复上一版本。

系统更新页面需要在容器环境中设置：

```dotenv
REQUIREMENT_PLATFORM_UPDATE_MODE=docker
REQUIREMENT_PLATFORM_DOCKER_IMAGE=ghcr.io/zhougepeng/requirement-platform
REQUIREMENT_PLATFORM_DOCKER_UPDATE_ENABLED=true
REQUIREMENT_PLATFORM_DATA_DIR=/app/data/requirement-platform
REQUIREMENT_PLATFORM_DOCKER_UPDATE_REQUEST_FILE=/app/data/requirement-platform/update-request
REQUIREMENT_PLATFORM_UPDATE_STATUS_FILE=/app/data/requirement-platform/update-status.json
```

这些变量已经包含在示例 Compose 文件中。更新请求和状态文件必须位于同一个持久化挂载目录，并且 Node 进程对该目录有写权限。

## 当前服务器的限制

当前 `ai-app` 上的 `zhougepeng` 账号只能执行服务器管理员预先放行的 `requirement-platformctl` 子命令，不能直接读取 Docker、修改 Compose 或安装 systemd 服务。因此不能把上述桥接服务直接安装到当前服务器，也不能把现有 `requirement-platformctl publish` 未确认地当作“按指定 GHCR tag 更新”。

在现有服务器上启用页面更新前，需要管理员完成一次接入：

1. 确认现有部署的 Compose 项目目录、数据挂载目录、容器名和 GHCR 登录方式。
2. 安装并启用更新桥接服务，或在 `requirement-platformctl` 中增加等价的受控 `publish-image <tag>` 能力。
3. 将页面容器的 `REQUIREMENT_PLATFORM_UPDATE_MODE=docker` 等变量加入实际环境，并重启容器。
4. 通过页面检查到新 Release 后，先在非高峰时段用一个新 tag 做一次更新和回滚演练。

完成标准：页面显示“最新镜像”，点击“拉取并更新”后状态变为成功，容器健康检查通过，需求数据和已发布 Demo 仍然存在；失败时页面显示失败状态且旧版本可恢复。
