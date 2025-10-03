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

### gather_chats

获取一个或多个对话。

**参数**：

- `chatIds`: string[] — 要合并的对话 ID 列表（至少 2 个；如果只传 1 个则进入“单会话查看”模式）
- `includeTools?`: boolean — 是否在结果中包含工具调用与结果（单会话与多会话均生效），默认 `true`

> 会话 id 可以右键复制得到

## 输出格式

会生成以下内容：

1. **单会话查看**（当 `chatIds.length === 1`）
   - 消息按时间线展示：`Me:`/`AI:` 区分角色
   - 若 `includeTools=true`，将追加展示每条消息解析到的“工具调用/工具结果”
2. **多会话合并**（当 `chatIds.length > 1`）
   - **元信息**：每个会话的基本信息（标题、时间范围）
   - **逐会话线性叙述**：按会话分组展示所有消息；若 `includeTools=true`，每条消息后追加展示解析到的“工具调用/工具结果”
   - **公共对齐**：标记在所有会话中都出现的共同消息

消息格式：`[会话#序号](ID前缀 时间) 角色: 内容`

## 环境变量

- `CHATWISE_DB_PATH`：ChatWise SQLite 数据库的绝对路径。如果在镜像/容器中通过 [mcphub](https://github.com/samanhappy/mcphub) 使用本项目，需要先在宿主机找到 ChatWise 数据库位置，并在启动 MCP 服务器前设置此变量。macOS 默认路径为 `~/Library/Application Support/app.chatwise/app.db`。

## 故障排除

- 错误 `code 127`：脚本文件缺失或无执行权限
- 数据库错误：检查 ChatWise 应用路径或设置 `CHATWISE_DB_PATH`（兼容 `DB_PATH`）环境变量

## 许可证

MIT
