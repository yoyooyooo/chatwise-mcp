# ChatWise MCP 服务器

👉 English version: [README.md](README.md)

ChatWise 的 MCP 服务器，用于获取对话的内容。

## 使用场景

在多个对话中讨论同一主题的不同视角后，新开对话时需要引用之前的讨论内容：

1. **对话A**：讨论"如何学习编程"的技术路线
2. **对话B**：讨论"如何学习编程"的学习方法  
3. **新对话**：综合前两个对话的观点，制定完整的学习计划

使用 `gather_chats` 可以快速获取对话A和B的完整内容，在新对话中引用。

## 安装

```bash
npx -y chatwise-mcp
```

## 工具

### search_conversations

按“意图/关键词”在 ChatWise 会话中搜索（基于本地 ChatWise SQLite）。按会话聚合命中并返回结构化 JSON，便于 LLM 消费与后续编排。

参数：
- `intent_query`: string | string[] — 模糊意图/关键词，或关键词数组（如 ["idea","想法"]）
- `time_window?`: '7d' | '30d' | '60d' | '90d' | 'all' | { start:number; end:number }（默认 'all'）
- `precision_mode?`: 'basic' | 'fuzzy'（默认 'basic'）
- `include_tools_in_search?`: boolean（默认 true）
- `exclude_terms?`: string[]（默认 []）
- `exclude_chat_ids?`: string[]（默认 []；可排除当前会话）
- `exclude_current_chat?`: boolean（默认 true）。为 true 时工具会尽量自动排除“当前会话”：
  - 若设置了环境变量 `CHATWISE_CURRENT_CHAT_ID` 则优先使用；
  - 否则在最近 15 分钟内，从 `message.meta` 中检测最近一次对本服务器 `search_conversations` 的工具调用所属的 `chatId` 并排除（尽力而为，仍建议显式传 `exclude_chat_ids` 以确保稳定）。
- `exclude_recent_user_secs?`: number（默认 60）。为避免“当前问题本身”把当前会话命中，忽略这段时间内的用户消息（仅影响匹配，不影响最终展示）。
 - 通配最近模式：将 `intent_query` 设为 `"*"` 可直接返回时间窗内“最近活跃”的会话（按 `max_ts` 倒序）。可配合 `limit_chats`（如 10）。若希望包含非常新的用户消息，将 `exclude_recent_user_secs` 设为 0。
- `user_only?`: boolean（默认 false；true 时仅搜索用户消息）
- `match?`: 'any' | 'all'（默认 'any'）
- `limit_chats?`: number（默认 10）
- `limit_snippets_per_chat?`: number（默认 3）
- `snippet_window?`: number（默认 64）

输出：JSON，含 `topChatIds`、`results[{ chatId, title, hits, timeRange, snippets[] }]` 与 `guidance`。

示例：
- 最近 60 天关于 Rust 的讨论：
  - `{ "intent_query": "rust", "time_window": "60d" }`
- 最近 90 天的“生活类”话题（仅用户消息）：
  - `{ "intent_query": ["life", "生活", "日常"], "time_window": "90d", "user_only": true }`
- 检索时排除当前会话：
  - `{ "intent_query": "virtual scrolling", "exclude_chat_ids": ["<currentChatId>"] }`
- 一次性检索“想法/idea”相关：
  - `{ "intent_query": ["idea", "ideas", "想法"], "match": "any" }`

### gather_chats

获取一个或多个对话。

**参数**：

- `chatIds`: string[] — 要合并的对话 ID 列表（至少 2 个；如果只传 1 个则进入“单会话查看”模式）
- `includeTools?`: boolean — 是否在结果中包含工具调用与结果（单会话与多会话均生效），默认 `true`。提示：在搜索后批量拉取时，可显式传 `includeTools=false` 以减少 tokens。

> 会话 id 可以右键复制得到

## 输出格式

输出为英文，包含以下内容：

1. **单会话查看**（当 `chatIds.length === 1`）
   - 段落标题："Chat Info"，随后是完整时间线；`Me:`/`AI:` 区分角色
   - 若 `includeTools=true`，每条消息后追加 `<Tool Call>/<Args>/<Tool Result>`
2. **多会话合并**（当 `chatIds.length > 1`）
   - **Meta**：每个会话的基本信息（Title、Time Range）
   - **Per-Chat Narrative**：按会话分组展示所有消息；若 `includeTools=true`，每条消息后追加 `<Tool Call>/<Args>/<Tool Result>`
   - **Common Alignment**：标记“在所有会话中都出现”的共同消息，并附上 `Refs: chat#index(idPrefix)`

消息格式：`[会话#序号](ID前缀 时间) 角色: 内容`

注：`search_conversations` 返回结构化 JSON（而非文本分段），用于驱动后续 `gather_chats` 调用。

示例：
- 拉取某个会话并包含工具结果：
  - `{ "chatIds": ["abc123"], "includeTools": true }`
- 合并多个会话但尽量少占 tokens（不含工具结果）：
  - `{ "chatIds": ["id1", "id2", "id3"], "includeTools": false }`
- 先用 `search_conversations` 定位 Top 2，再拉取不含工具结果的全文；需要深入时对单个会话开启工具：
  - 第一步：`{ "chatIds": ["<top1>", "<top2>"], "includeTools": false }`
- 第二步（深读）：`{ "chatIds": ["<top1>"], "includeTools": true }`

### delete_conversation

删除指定对话及其所有消息（基于本地 ChatWise SQLite）。支持 dry-run 预览删除数量。

参数：
- `chatId`: string — 要删除的对话 ID
- `dry_run?`: boolean — 默认为 `false`。为 `true` 时仅返回待删除行数，不执行删除

返回：JSON，例如：
- dry-run：`{ "status": "ok", "dryRun": true, "chatId": "abc", "exists": true, "toDelete": { "chat": 1, "messages": 42 } }`
- 实际删除：`{ "status": "ok", "dryRun": false, "chatId": "abc", "deleted": { "chat": 1, "messages": 42 } }`

注意：仅删除数据库行（`message` 与 `chat`），不会清理磁盘上的文件（如 `generatedFiles` 引用）。

## 环境变量

- `CHATWISE_DB_PATH`：ChatWise SQLite 数据库的绝对路径。如果在镜像/容器中通过 [mcphub](https://github.com/samanhappy/mcphub) 使用本项目，需要先在宿主机找到 ChatWise 数据库位置，并在启动 MCP 服务器前设置此变量。macOS 默认路径为 `~/Library/Application Support/app.chatwise/app.db`。

## 故障排除

- 错误 `code 127`：脚本文件缺失或无执行权限
- 数据库错误：检查 ChatWise 应用路径或设置 `CHATWISE_DB_PATH`（兼容 `DB_PATH`）环境变量

## 许可证

MIT
