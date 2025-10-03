# ChatWise MCP Server

👉 中文版请见 [README.zh.md](README.zh.md)

MCP server for ChatWise that retrieves conversation content.

## Use Case

When discussing the same topic from different perspectives across multiple conversations, then starting a new conversation that needs to reference previous discussions:

1. **Conversation A**: Discuss "how to learn programming" focusing on technical roadmap
2. **Conversation B**: Discuss "how to learn programming" focusing on learning methods
3. **New Conversation**: Synthesize insights from both conversations to create a comprehensive learning plan

Use `gather_chats` to quickly retrieve complete content from conversations A and B for reference in the new conversation.

## Installation

```bash
npx -y chatwise-mcp
```

## Tools

### gather_chats

Gather one or more conversations.

**Parameters**:

- `chatIds`: string[] — List of chat IDs. If one ID is provided, the tool returns the full timeline for that single chat; if multiple, it merges them.
- `includeTools?`: boolean — When viewing a single chat, whether to include tool calls/results parsed from message metadata. Default `true`.

> Chat IDs can be obtained by right-clicking to copy

## Output Format

Outputs include:

1. **Single Chat View** (when `chatIds.length === 1`)
   - Full message timeline with `Me:`/`AI:` markers
   - If `includeTools=true`, appends parsed tool calls/results per message
2. **Merged View** (when `chatIds.length > 1`)
   - **Meta Information**: Basic info for each conversation (title, time range)
   - **Sequential Chat Narratives**: All messages grouped by conversation
   - **Common Content Alignment**: Marks shared messages that appear in all conversations

Message format: `[Chat#Index](ID prefix Time) Role: Content`

## Environment Variables

- `CHATWISE_DB_PATH`: Absolute path to the ChatWise SQLite database. When using [mcphub](https://github.com/samanhappy/mcphub) inside a mirrored container, resolve the host machine's ChatWise path and set this variable before starting the MCP server. On macOS the default location is `~/Library/Application Support/app.chatwise/app.db`.

## Troubleshooting

- Error `code 127`: Missing script file or no execute permission
- Database error: Check ChatWise app path or set `CHATWISE_DB_PATH` (fallback to `DB_PATH`) environment variable

## License

MIT
