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
- `user_only?`: boolean（默认 false；true 时仅搜索用户消息）
- `match?`: 'any' | 'all'（默认 'any'）
- `limit_chats?`: number（默认 10）
- `limit_snippets_per_chat?`: number（默认 3）
- `snippet_window?`: number（默认 64）

输出：JSON，含 `topChatIds`、`results[{ chatId, title, hits, timeRange, snippets[] }]` 与 `guidance`。

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

## 环境变量

- `CHATWISE_DB_PATH`：ChatWise SQLite 数据库的绝对路径。如果在镜像/容器中通过 [mcphub](https://github.com/samanhappy/mcphub) 使用本项目，需要先在宿主机找到 ChatWise 数据库位置，并在启动 MCP 服务器前设置此变量。macOS 默认路径为 `~/Library/Application Support/app.chatwise/app.db`。

## 故障排除

- 错误 `code 127`：脚本文件缺失或无执行权限
- 数据库错误：检查 ChatWise 应用路径或设置 `CHATWISE_DB_PATH`（兼容 `DB_PATH`）环境变量

## 许可证

MIT
