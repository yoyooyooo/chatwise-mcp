import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { mergeChatsByIds } from "../mergeChatsByIds.js"

export function registerGatherChatsTool(server: McpServer) {
  server.tool(
    "gather_chats",
    `Gather and merge multiple chat conversations into a unified timeline with automatic deduplication.

<usecase>
Perfect for: consolidating related chat threads, creating comprehensive conversation histories, combining fragmented chat sessions, preparing chat data for analysis or review.
Examples: merging conversations from the same project, consolidating customer support threads, combining related discussion topics
</usecase>

<instructions>
1. Provide an array of chat IDs you want to merge together
2. Tool automatically removes duplicate messages and sorts by timestamp
3. Returns a unified conversation timeline in text format
4. Ideal for preparing consolidated chat histories for review or analysis
5. Use specific chat IDs from your system (e.g., "chat_123", "conversation_456")
</instructions>`,
    {
      chatIds: z
        .array(z.string())
        .nonempty()
        .describe("Array of chat identifiers to merge (e.g., ['chat_123', 'conv_456', 'thread_789']). Must contain at least one valid chat ID."),
    },
    async (args) => {
      const ids = args.chatIds as string[]

      try {
        const result = mergeChatsByIds({ chatIds: ids })
        return { content: [{ type: "text", text: result }] }
      } catch (error) {
        console.error("Error in mergeChatsByIds:", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to merge chats: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    }
  )
}
