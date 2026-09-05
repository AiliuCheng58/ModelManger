# Model Atelier

本机运行的个人模型 API 工作台。网页集中管理 OpenAI 兼容供应商、模型专长、任务和调用记录；HTTP API 与 MCP 为开发 agent 提供统一调用入口。

## 启动

环境：Node.js 22.16 或更高版本，pnpm 10.26 或更高版本。

```powershell
pnpm install
pnpm build
pnpm start
```

打开 <http://127.0.0.1:4317>，首次使用设置管理口令。

也可以通过 PowerShell 脚本启动：

```powershell
.\Start.ps1
.\Start.ps1 -NodePath 'C:\path\to\node.exe'
```

开发模式提供页面热更新：

```powershell
pnpm dev
```

环境变量 `PORT` 指定服务端口，`MODEL_ATELIER_DATA` 指定数据目录。服务监听 `127.0.0.1`。

## 使用流程

1. 在「供应商」添加 API 根地址和密钥，例如 `https://api.example.com/v1`。根路径地址会补充 `/v1`，自定义路径按填写内容使用。
2. 点击「测试连接」或「拉取模型」。测试连接验证 `/models` 的访问权限和响应结构，模型实际调用结果可在任务记录查看。
3. 在「模型目录」为模型配置启停状态、专长标签和说明。再次同步会保留这些配置；上游不再提供的模型会标记为下架。
4. 在「接入配置」创建 agent 访问令牌，复制对应的 MCP 配置。
5. 主 agent 查看模型目录、选择模型并提交任务。平台异步调用模型并保存结果，主 agent 读取代码后在自己的项目中应用与验证。
6. 将修改意见和最新代码通过 `Task_continue` 发送到原任务，继续下一轮。

管理页面支持直接提交任务、查看各轮输入和输出、复制结果及取消当前轮。

## MCP

接入地址：`http://127.0.0.1:4317/mcp`，使用 Streamable HTTP 与 Bearer 访问令牌。

| 工具 | 用途 |
| --- | --- |
| `Model_list` | 列出启用模型、专长、说明和唯一 ID |
| `Task_submit` | 提交模型、任务说明与代码上下文，立即返回任务 ID |
| `Task_get` | 查询任务和每一轮的状态摘要 |
| `Task_result` | 分段读取指定轮结果，沿 `nextOffset` 继续获取 |
| `Task_continue` | 携带反馈和更新后的上下文继续原任务 |
| `Task_cancel` | 取消当前排队或运行中的轮次 |

Codex 的 `~/.codex/config.toml`：

```toml
[mcp_servers.model_atelier]
url = "http://127.0.0.1:4317/mcp"
bearer_token_env_var = "MODEL_ATELIER_TOKEN"
```

在启动 Codex 的 PowerShell 中设置令牌，再从该终端启动客户端：

```powershell
$env:MODEL_ATELIER_TOKEN = 'YOUR_ACCESS_TOKEN'
```

桌面客户端可使用用户环境变量，设置后重新启动客户端：

```powershell
[Environment]::SetEnvironmentVariable('MODEL_ATELIER_TOKEN', 'YOUR_ACCESS_TOKEN', 'User')
```

oh my pi 的 `~/.omp/agent/mcp.json`：

```json
{
  "mcpServers": {
    "model_atelier": {
      "type": "http",
      "url": "http://127.0.0.1:4317/mcp",
      "headers": { "Authorization": "Bearer YOUR_ACCESS_TOKEN" }
    }
  }
}
```

模型列表中的 `id` 在不同供应商间保持唯一；仅当远端模型名在启用目录中唯一时，也可直接使用模型名。

## HTTP API

agent 请求携带 `Authorization: Bearer YOUR_ACCESS_TOKEN`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/v1/models` | OpenAI 格式模型目录 |
| POST | `/v1/chat/completions` | Chat Completions 调用，支持流式转发与工具定义透传 |
| GET | `/api/models` | 含专长的启用模型目录 |
| GET | `/api/tasks` | 最近任务，`limit` 为 1–200，默认 100 |
| POST | `/api/tasks` | 创建异步任务 |
| GET | `/api/tasks/:id` | 完整任务和多轮记录 |
| GET | `/api/tasks/:id/result` | 分段读取结果，参数为 `round`、`offset`、`limit` |
| POST | `/api/tasks/:id/continue` | 追加一轮 |
| POST | `/api/tasks/:id/cancel` | 取消当前轮 |

```powershell
$headers = @{ Authorization = 'Bearer YOUR_ACCESS_TOKEN' }
$body = @{
    model = 'MODEL_ID_FROM_CATALOG'
    title = '实现产品首页'
    prompt = '根据以下代码实现响应式首页，返回完整文件内容。'
    context = '相关源代码和需求'
} | ConvertTo-Json

$task = Invoke-RestMethod -Method Post `
    -Uri 'http://127.0.0.1:4317/api/tasks' `
    -Headers $headers -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($body))

Invoke-RestMethod -Uri "http://127.0.0.1:4317/api/tasks/$($task.id)" -Headers $headers
```

创建任务的可选字段：`title`、`context`、`temperature`、`maxTokens`、`timeoutSeconds`。默认超时 600 秒，同时执行至多两个任务；每个任务在当前轮结束后接受下一轮。`maxTokens` 对应上游 `max_tokens`，留空使用服务商默认值。

任务状态为 `queued`、`running`、`succeeded`、`failed`、`cancelled`。返回 `finishReason: "length"` 表示上游输出达到长度上限，可继续任务获取后续内容。重启会恢复排队任务，并将中断的运行轮次标记为失败。

调用统计使用服务商实际返回的用量；缺失用量显示为「未上报」。流式客户端可按供应商支持情况发送 `stream_options.include_usage`。

## 本地数据

默认数据存储在 `data/`：

- `atelier.sqlite`：供应商、模型、完整任务上下文、调用统计、会话与令牌哈希。
- `secret.key`：供应商凭据的 AES-GCM 加密密钥。

停止服务后备份整个数据目录；恢复时保留数据库和对应的 `secret.key`。管理口令使用 scrypt 派生哈希。agent 令牌只允许访问模型和任务，供应商及令牌管理需要浏览器登录会话。

## 验证与源码

```powershell
pnpm check
pnpm test
pnpm build
```

集成检查使用本地模拟供应商和官方 MCP 客户端，覆盖权限、同步、多轮任务、取消、错误处理及流式调用。

`server/` 按数据存储、供应商、任务、HTTP 和 MCP 组织；`src/` 按页面组织。开发服务与生产服务使用同一套后端。

接口参考：[OpenAI 模型列表](https://developers.openai.com/api/reference/resources/models/methods/list)、[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。
