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

### search_conversations

Search ChatWise conversations by intent (from the local ChatWise SQLite database). Aggregates matches by conversation and returns structured JSON for LLMs.

Parameters:
- `intent_query`: string | string[] — Fuzzy intent/keyword, or an array like ["idea","想法"]
- `time_window?`: '7d' | '30d' | '60d' | '90d' | 'all' | { start:number; end:number } (default 'all')
- `precision_mode?`: 'basic' | 'fuzzy' (default 'basic')
- `include_tools_in_search?`: boolean (default true)
- `exclude_terms?`: string[] (default [])
- `exclude_chat_ids?`: string[] (default [])
- `exclude_current_chat?`: boolean (default true). When true, the tool will try to auto‑exclude the current chat: first via env `CHATWISE_CURRENT_CHAT_ID`, otherwise by detecting the most recent `search_conversations` tool call (within the last 15 minutes) in `message.meta` and excluding its `chatId` (best‑effort; still recommend passing `exclude_chat_ids` explicitly for determinism).
- `exclude_recent_user_secs?`: number (default 60). To avoid matching the current prompt itself, ignore very recent user messages within this window (affects matching only; not output rendering).
 - Wildcard recent mode: set `intent_query` to `"*"` to list the most recent chats (by `max_ts`) within the time window. Combine with `limit_chats` (e.g., 10). If you also want to include very fresh user messages, set `exclude_recent_user_secs: 0`.
- `user_only?`: boolean (default false; when true, only user messages are searched)
- `match?`: 'any' | 'all' (default 'any')
- `limit_chats?`: number (default 10)
- `limit_snippets_per_chat?`: number (default 3)
- `snippet_window?`: number (default 64)

Output: JSON with fields `topChatIds`, `results[{ chatId, title, hits, timeRange, snippets[] }]`, and `guidance`.

Examples:
- Recent Rust discussions in the last 60 days:
  - `{ "intent_query": "rust", "time_window": "60d" }`
- "Life" topics in the last 90 days (user messages only):
  - `{ "intent_query": ["life", "生活", "日常"], "time_window": "90d", "user_only": true }`
- Exclude the current chat from results:
  - `{ "intent_query": "virtual scrolling", "exclude_chat_ids": ["<currentChatId>"] }`
- Broad "ideas" search combining English and Chinese terms:
  - `{ "intent_query": ["idea", "ideas", "想法"], "match": "any" }`

### gather_chats

Gather one or more conversations.

**Parameters**:

- `chatIds`: string[] — List of chat IDs. If one ID is provided, the tool returns the full timeline for that single chat; if multiple, it merges them.
- `includeTools?`: boolean — Whether to include tool calls/results parsed from message metadata in outputs (applies to both single and merged views). Default `true`. Tip: when pulling many chats after a search, set `includeTools: false` to reduce tokens.

> Chat IDs can be obtained by right-clicking to copy

## Output Format

Outputs (all section titles are in English):

1. **Single Chat View** (when `chatIds.length === 1`)
   - Sections: `Chat Info`, then `Messages`
   - Timeline rows use `Me:`/`AI:` markers
   - If `includeTools=true`, appends `<Tool Call>/<Args>/<Tool Result>` blocks after each message
2. **Merged View** (when `chatIds.length > 1`)
   - Sections: `Meta`, `Per-Chat Narrative`, `Common Alignment`
   - In `Per-Chat Narrative`, messages are grouped by chat; if `includeTools=true`, tool blocks are appended per message
   - `Common Alignment` contains only messages that appear in all chats, with `Refs: chat#index(idPrefix)`

Row format examples:
- Single chat: `[#[Index]](IDprefix Time) Role: Content`
- Merged narrative: `[Chat#Index](IDprefix Time) Role: Content`

Note: `search_conversations` returns structured JSON (not text sections) to drive follow‑up calls (e.g., `gather_chats`).

Examples:
- Pull a single conversation with tool outputs:
  - `{ "chatIds": ["abc123"], "includeTools": true }`
- Merge several conversations while minimizing tokens (no tool outputs):
  - `{ "chatIds": ["id1", "id2", "id3"], "includeTools": false }`
- After `search_conversations`, pull top 2 chats without tool outputs, then re‑pull a specific chat with tools enabled if needed:
  - First: `{ "chatIds": ["<top1>", "<top2>"], "includeTools": false }`
  - Then (deep dive): `{ "chatIds": ["<top1>"], "includeTools": true }`

### delete_conversation

Delete a specific conversation and all its messages (from the local ChatWise SQLite database). Supports dry‑run.

Parameters:
- `chatId`: string — ID of the chat to delete
- `dry_run?`: boolean — Defaults to `false`. When `true`, returns counts only and performs no deletion

Returns: JSON, for example:
- dry‑run: `{ "status": "ok", "dryRun": true, "chatId": "abc", "exists": true, "toDelete": { "chat": 1, "messages": 42 } }`
- deletion: `{ "status": "ok", "dryRun": false, "chatId": "abc", "deleted": { "chat": 1, "messages": 42 } }`

Note: Only deletes DB rows (`message` and `chat`); it does not remove any files on disk referenced by `generatedFiles`.

## Environment Variables

- `CHATWISE_DB_PATH`: Absolute path to the ChatWise SQLite database. When using [mcphub](https://github.com/samanhappy/mcphub) inside a mirrored container, resolve the host machine's ChatWise path and set this variable before starting the MCP server. On macOS the default location is `~/Library/Application Support/app.chatwise/app.db`.

## Troubleshooting

- Error `code 127`: Missing script file or no execute permission
- Database error: Check ChatWise app path or set `CHATWISE_DB_PATH` (fallback to `DB_PATH`) environment variable

## License

MIT
