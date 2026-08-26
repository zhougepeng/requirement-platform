# 飞书扫码登录配置

需求管理平台的飞书登录只接受指定企业的成员。登录成功后会记录本地员工资料；新成员默认是普通成员且默认可用，管理员可在员工管理中停用其访问权限或授予管理员权限。首次部署如需管理员，请用 `FEISHU_ADMIN_OPEN_IDS` 明确指定，系统不会因为“第一个登录”自动授予管理员。

## 1. 在飞书开放平台配置应用

1. 创建或打开企业自建应用，启用 **网页应用登录**。
2. 在安全设置中添加回调地址，必须与下面的 `FEISHU_REDIRECT_URI` 完全一致：
   `https://你的域名/auth/callback`
3. 在权限管理中申请用户基本信息相关权限。平台登录只读取 `open_id`、姓名、头像和 `tenant_key`；如果还要同步组织架构，再按现有“员工管理”的提示申请通讯录读取权限。
4. 发布应用版本，并由企业管理员完成应用可用范围和权限审批。

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

旧配置 `FEISHU_ALLOWED_TENANT_KEYS` 仅保留兼容读取，生产环境请改用单个的 `FEISHU_ALLOWED_TENANT_KEY`。

## 3. 本地调试

飞书回调地址需要能被飞书访问。`localhost` 通常不能直接用于实际扫码回调；本地调试应使用临时 HTTPS 隧道域名，并把 `FEISHU_REDIRECT_URI` 同时更新为该域名的 `/auth/callback`。开发环境若不准备调试飞书登录，可以保留 `AUTH_MODE=local`。

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
| 登录后仍无权限 | 管理员可能已在员工管理中停用了该员工。 |

## 官方文档

- [网页应用扫码登录 SDK](https://open.feishu.cn/document/sso/web-application-sso/qr-sdk-documentation)
- [获取 OAuth 授权码](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code)
- [服务端获取用户信息](https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/get)
