# Dify 知识库接入

需求平台仍是唯一事实源。Dify 只保存最新有效需求的检索副本，不保存 Demo 的 HTML、CSS、JavaScript，也不使用历史版本作为默认问答依据。

## 1. 在 Dify 创建知识库

创建一个普通知识库，配置可用的 Embedding / Rerank 模型，并生成有知识库读写权限的 API Key。平台会在第一次同步时创建以下 Metadata 字段：

- `project_id`、`project_name`
- `requirement_id`、`requirement_name`
- `status`、`release_version`、`release_date`
- `content_type`、`source_updated_at`

## 2. 配置方式

推荐管理员登录需求平台后，从左下角个人菜单打开“Dify 知识库”，填写服务地址、知识库 ID 和 Dataset API Key，点击“保存并验证”，再执行“同步全部需求”。此入口仅管理员可见，浏览器不会获得或回显完整 API Key。

要启用页面保存能力，服务器仍需预先设置一项只由运维保管的加密密钥：

```ini
DIFY_CONFIG_ENCRYPTION_KEY=至少32位的随机字符串
```

该密钥用于加密服务器数据目录中的 Dify API Key。请勿变更；变更后旧配置将无法解密，需要管理员重新输入 API Key。

如果暂时不开放管理员页面配置，也可继续使用部署环境变量作为兜底：

在需求平台的 `.env.local` 中填写：

```ini
DIFY_API_BASE_URL=https://your-dify.example.com/v1
DIFY_API_KEY=你的知识库 API Key
DIFY_DATASET_ID=你的知识库 ID
```

管理员页面保存的配置优先于这组三个环境变量。不要使用 `NEXT_PUBLIC_` 前缀，也不要把 API Key 放进模型管理、浏览器或 Git。

## 3. 首次导入

安装依赖后，在 Node.js 22 或更高版本执行：

```powershell
npm run sync-existing-knowledge
```

该命令可重复执行：内容未变不会重复创建文档；内容、上线状态或测试用例变化时更新已有文档；已经不存在测试用例的需求会移除对应测试用例文档。

## 4. 后续同步与失败处理

发布需求、发布新版本、恢复版本、修改上线状态、生成或更新测试用例后，平台会在保存成功后异步同步 Dify。Dify 故障不会影响 PRD、版本和测试用例保存。

同步失败会记录在 `dify-knowledge-sync.local.json`，下一次使用智能体时会在后台重试；也可以手工再次运行初始化同步命令。

## 权限与上线状态

当前平台的查看权限是全局权限。后端会根据登录用户和真实的项目/需求范围确认可检索集合，再用同步映射过滤 Dify 返回的每一个片段，未通过校验的内容不会传给模型。

当前 Dify 的公开知识库检索 API 不支持稳定的文档 Metadata 条件过滤，因此 Metadata 用于资料管理和审计，权限过滤由需求平台后端强制执行。用户提问当前能力时，只使用 `online` 内容；没有已上线结果时才用 `offline` 内容说明“当前暂不支持，但已有规划”。
