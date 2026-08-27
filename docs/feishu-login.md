# 飞书扫码登录配置

需求管理平台的飞书登录只接受指定企业的成员。登录成功后会记录本地员工资料；新成员默认是“未授权”，管理员在员工权限中为其设置角色。首次部署如需管理员，请用 `FEISHU_ADMIN_OPEN_IDS` 明确指定，系统不会因为“第一个登录”自动授予管理员。

## 权限角色

平台不做项目级或需求级权限隔离，拥有“查看”及以上角色即可看到全部项目和需求：

| 角色 | 能力 |
| --- | --- |
| 未授权 | 不能进入需求库 |
| 查看 | 查看全部项目和需求、发表评论、使用 AI 助手 |
| 发布 | 包含查看能力；创建和编辑项目、发布需求与版本、恢复版本 |
| 管理 | 包含发布能力；管理员工权限、模型和系统更新（模板管理预留在此角色） |

管理员在“员工权限”窗口中直接选择角色。重新同步飞书只更新姓名、头像、部门和在职状态，不会覆盖已设置的角色。

## 1. 在飞书开放平台配置应用

1. 创建或打开企业自建应用，启用 **网页应用登录**。
2. 在安全设置中添加回调地址，必须与下面的 `FEISHU_REDIRECT_URI` 完全一致：
   `https://你的域名/auth/callback`
3. 在权限管理中申请用户基本信息相关权限。平台登录只读取 `open_id`、姓名、头像和 `tenant_key`；如果还要同步组织架构，再按现有“员工管理”的提示申请通讯录读取权限。
4. 发布应用版本，并由企业管理员完成应用可用范围和权限审批。要同步全员，应用可用范围必须包含对应员工或部门，不能只包含应用创建者。

不要把 `App Secret` 写到前端、浏览器地址或 Git 仓库中。

## 2. 服务器环境变量

将 `.env.local.example` 复制为服务器上的 `.env.local`，填写以下项目：

```ini
AUTH_MODE=feishu
AUTH_SESSION_SECRET=至少32位的随机字符串
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=飞书应用密钥
FEISHU_REDIRECT_URI=https://你的域名/auth/callback
FEISHU_ALLOWED_TENANT_KEY=你的企业tenant_key
```

`FEISHU_ALLOWED_TENANT_KEY` 是唯一允许登录的企业标识，不能为空。可从已确认属于本企业的飞书用户信息或飞书开放平台的企业信息中获得；不要填公司名称、App ID 或 open_id。

不知道 tenant_key 时，可临时在服务器设置 `FEISHU_TENANT_DISCOVERY=true` 并重启服务。此模式下使用公司飞书扫码确认后，平台只显示当前账号的 `tenant_key`，不会创建登录 Session。复制该值填入 `FEISHU_ALLOWED_TENANT_KEY` 后，删除 `FEISHU_TENANT_DISCOVERY=true` 并再次重启服务。

旧配置 `FEISHU_ALLOWED_TENANT_KEYS` 仅保留兼容读取，生产环境请改用单个的 `FEISHU_ALLOWED_TENANT_KEY`。

## 3. 本地调试

飞书回调地址需要能被飞书访问。`localhost` 通常不能直接用于实际扫码回调；本地调试应使用临时 HTTPS 隧道域名，并把 `FEISHU_REDIRECT_URI` 同时更新为该域名的 `/auth/callback`。开发环境若不准备调试飞书登录，可以保留 `AUTH_MODE=local`。

临时没有域名时，也可以在飞书应用的安全设置登记 `http://公网IP:3000/auth/callback`，并在服务器设置：

```ini
AUTH_MODE=feishu
APP_BASE_URL=http://公网IP:3000
FEISHU_REDIRECT_URI=http://公网IP:3000/auth/callback
AUTH_COOKIE_SECURE=false
```

`AUTH_COOKIE_SECURE=false` 仅用于 HTTP IP 的短期调试，否则浏览器不会保存带 Secure 标记的登录 Cookie。该方式的网络传输没有 HTTPS 保护，拿到域名后应改为 `https://域名/auth/callback` 并删除此配置。

## 4. 登录流程与安全边界

1. 未登录访问页面会被统一跳转到 `/login`；接口返回 401。
2. 登录页调用飞书官方二维码 SDK 展示扫码二维码。
3. 服务端将一次性随机 `state`、安全的原页面地址和 10 分钟有效期签名后写入 HttpOnly Cookie。
4. 回调必须匹配该 `state`，服务端再以 App Secret 换取用户信息，精确比对 `tenant_key`。
5. 企业不匹配、授权取消、state 失效或配置缺失都会回到登录页并显示通用提示；不会输出 App Secret 或 token。
6. 成功后只允许回到站内相对路径，拒绝外部跳转地址。

飞书当前的二维码 SDK 文档仍注明二维码方式需要使用其旧版扫码授权地址；本项目仅在二维码 SDK 这一环使用该官方指定地址，用户身份与企业校验始终在服务端完成。

## 5. 常见问题

| 现象 | 检查项 |
| --- | --- |
| 显示“飞书登录尚未完成配置” | 五项必填变量、回调地址是否为完整 `http(s)` 地址、会话密钥是否至少 32 位。 |
| 扫码后提示无访问权限 | `FEISHU_ALLOWED_TENANT_KEY` 与当前飞书账号所属企业不一致。 |
| 飞书提示回调地址不匹配 | 飞书后台登记的地址与 `FEISHU_REDIRECT_URI` 必须逐字符一致，包括 `https`、域名、端口与路径。 |
| 登录后仍无权限 | 管理员可能尚未在员工权限中将该员工设为“查看”或更高角色。 |
| 同步后只有一名员工 | 检查应用可用范围是否只包含当前员工；确认通讯录读取权限已审批且应用版本已发布；确认目标员工属于应用可见部门。平台会保留飞书接口返回的错误码和错误消息，若页面未报错通常表示飞书只返回了这一名可见员工。 |

## 官方文档

- [网页应用扫码登录 SDK](https://open.feishu.cn/document/sso/web-application-sso/qr-sdk-documentation)
- [获取 OAuth 授权码](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code)
- [服务端获取用户信息](https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/get)
