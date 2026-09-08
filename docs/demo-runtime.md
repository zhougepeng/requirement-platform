# 可启动 Demo 发布（P1）

## 发布包契约

工作搭子从关联 Demo 目录检测到 `package.json` 的 `scripts.start` 后，会额外写入 `runtime.json`：

```json
{
  "kind": "node-npm-script",
  "command": "npm-start",
  "port": 3000,
  "healthPath": "/"
}
```

`command` 是平台内部的固定适配器，不是可执行的 shell 字符串，目前支持 `npm-start` 和 `npm-dev`。只有同时具备这个清单和对应 npm 脚本的版本才会登记为运行态 Demo；没有清单的普通 ZIP 仍按静态 HTML 处理。

## 启动与访问

运行态不会在发布时立即执行。首次访问
`/demo-runtime/{项目编码}/{需求编码}/v{版本号}/` 时，需求库使用独立端口启动该版本的 `npm start` 或 `npm run dev`，注入 `HOST=127.0.0.1` 和分配的 `PORT`，然后轮询健康路径。启动失败会回收进程和端口；启动新版本时会停止同一需求的旧运行实例，只有新版本健康检查通过后才切换。

服务端必须显式设置：

```text
REQUIREMENT_PLATFORM_ENABLE_DEMO_RUNTIME=true
```

默认关闭，避免普通上传包被当作服务器代码执行。运行实例使用固定 `npm` 可执行文件、`shell: false`、版本独立工作目录和端口池，并只传递启动所需的 OS 环境变量，不传递需求库密钥；当前 P1 不替代容器隔离，生产环境仍建议放在专用运行节点或容器中。

## 运维接口

- `GET /api/v1/requirements/{需求编码}/versions/{版本号}/runtime`：查看状态与最近日志。
- `POST .../runtime`：手动预热并健康检查。
- `DELETE .../runtime`：停止当前实例。

静态 HTML 版本继续使用原来的 `/demo-assets/...` 地址，不受运行态开关影响。
