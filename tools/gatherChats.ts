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
- Single chat: viewing complete conversation history for one chat
- Multiple chats: consolidating related chat threads, creating comprehensive conversation histories, combining fragmented chat sessions, preparing chat data for analysis or review.
Examples: reviewing a single important conversation, merging conversations from the same project, consolidating customer support threads, combining related discussion topics
</usecase>

<instructions>
1. For single chat: provide one chat ID to view its complete conversation history
2. For multiple chats: provide an array of chat IDs to merge together with automatic deduplication and sorting by timestamp
3. Returns unified conversation timeline in text format
4. Ideal for preparing consolidated chat histories for review or analysis
5. Use specific chat IDs from your system (e.g., "chat_123", "conversation_456")
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
        .describe(
          "Whether to include tool calls/results in responses when viewing a single chat. Default: true."
        ),
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
