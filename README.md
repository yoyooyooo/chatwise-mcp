# ChatWise MCP Server

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

- `chatIds`: string[] — List of chat IDs to merge (minimum 2 required)

> Chat IDs can be obtained by right-clicking to copy

## Output Format

Generates three sections:

1. **Meta Information**: Basic info for each conversation (title, time range)
2. **Sequential Chat Narratives**: All messages grouped by conversation, with `Me:` and `AI:` role distinction
3. **Common Content Alignment**: Marks shared messages that appear in all conversations

Message format: `[Chat#Index](ID prefix Time) Role: Content`

## Troubleshooting

- Error `code 127`: Missing script file or no execute permission
- Database error: Check ChatWise app path or set `DB_PATH` environment variable

## License

MIT
