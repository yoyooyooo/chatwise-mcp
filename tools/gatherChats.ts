import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { mergeChatsByIds } from "../mergeChatsByIds.js"
import { getSingleChatById } from "../getSingleChatById.js"

export function registerGatherChatsTool(server: McpServer) {
  server.tool(
    "gather_chats",
    `Gather and merge multiple chat conversations or view a single chat conversation.

<usecase>
Perfect for:
- Single chat: viewing the complete conversation timeline
- Multiple chats: consolidating related threads, creating comprehensive histories, combining fragmented sessions, preparing chat data for analysis or review
Examples: reviewing a single important conversation, merging conversations from the same project, consolidating customer support threads, combining related discussion topics
</usecase>

<behavior>
- Single chat: returns "Chat Info" and a full message timeline with role markers (Me:/AI:). If includeTools=true, appends per-message tool call/result blocks parsed from metadata.
- Multiple chats: returns three sections — "Meta", "Per-Chat Narrative", and "Common Alignment". If includeTools=true, appends per-message tool call/result blocks in the narrative section. "Common Alignment" is computed from role+content only (ignores tool blocks, files, citations, etc.).
</behavior>

<parameters>
- chatIds (string[]): For a single chat, provide one ID. For merging, provide multiple IDs (e.g., ['chat_123'] or ['chat_123', 'conv_456']).
- includeTools (boolean, optional, default: true): Whether to include tool calls/results in outputs (applies to both single and merged views).
</parameters>

<instructions>
1. For a single chat, pass exactly one chat ID
2. For multiple chats, pass an array of chat IDs; results are merged and ordered by timestamp
3. Returns a single text block suitable for direct inclusion in prompts or notes
4. Use specific chat IDs from your system (e.g., "chat_123", "conversation_456")
</instructions>`,
    {
      chatIds: z
        .array(z.string())
        .nonempty()
        .describe(
          "Array of chat identifiers. For single chat viewing, provide one chat ID. For merging multiple chats, provide multiple IDs (e.g., ['chat_123'] or ['chat_123', 'conv_456', 'thread_789']). Must contain at least one valid chat ID."
        ),
      includeTools: z
        .boolean()
        .optional()
        .describe("Whether to include tool calls/results (single and merged views). Default: true."),
    },
    async (args) => {
      const ids = args.chatIds as string[]
      const includeTools = (args as any).includeTools ?? true

      try {
        let result: string
        
        if (ids.length === 1) {
          // 单会话查询
          result = getSingleChatById({ chatId: ids[0], includeTools })
        } else {
          // 多会话合并
          result = mergeChatsByIds({ chatIds: ids, includeTools })
        }
        
        return { content: [{ type: "text", text: result }] }
      } catch (error) {
        console.error("Error in gather_chats:", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to process chats: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    }
  )
}
