import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import Database from "better-sqlite3"
import fs from "node:fs"
import { resolveDatabasePath } from "../databasePath.js"

export function registerDeleteConversationTool(server: McpServer) {
  server.tool(
    "delete_conversation",
    `Delete one or multiple ChatWise conversations and their related rows.

<usecase>
Perfect for:
- Removing one or multiple chats and all their messages from the local ChatWise SQLite database
- Previewing what would be deleted via dry-run before committing
</usecase>

<behavior>
- Performs a transactional delete: first messages by chatId, then the chat row(s)
- If dry_run=true, returns counts only without deleting
- Does NOT remove any referenced files on disk (e.g., generatedFiles); only DB rows
</behavior>

<parameters>
- chatId (string) or chatIds (string[]): ID or list of chat IDs to delete
- dry_run (boolean, optional, default: false): When true, only counts affected rows and does not delete
</parameters>`,
    {
      chatId: z.string().min(1).describe("ID of the chat to delete").optional(),
      chatIds: z.array(z.string().min(1)).nonempty().describe("IDs of the chats to delete").optional(),
      dry_run: z
        .boolean()
        .optional()
        .describe("When true, only returns counts; no deletion is performed"),
    },
    async (args) => {
      const chatIdSingle = args.chatId ? String(args.chatId).trim() : ""
      const chatIdsArray = Array.isArray(args.chatIds)
        ? (args.chatIds as string[]).map((s) => String(s).trim()).filter(Boolean)
        : []
      // normalize ids: prefer chatIds if provided; else fallback to single
      const idsRaw = chatIdsArray.length > 0 ? chatIdsArray : (chatIdSingle ? [chatIdSingle] : [])
      // unique & sanitize
      const seen = new Set<string>()
      const chatIds = idsRaw.filter((id) => {
        if (!id) return false
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      if (chatIds.length === 0) {
        const text = JSON.stringify({ status: "error", error: "chatId or chatIds must be provided" })
        return { content: [{ type: "text", text }], isError: true }
      }
      const dryRun = (args.dry_run as boolean | undefined) ?? false

      const dbPath = resolveDatabasePath(process.env.CHATWISE_DB_PATH)
      if (!fs.existsSync(dbPath)) {
        const text = JSON.stringify({
          status: "error",
          error: `Database not found: ${dbPath}`,
        })
        return { content: [{ type: "text", text }] }
      }

      const db = Database(dbPath) // read-write

      try {
        // helper to chunk arrays to avoid SQLite 999 variables limit
        function chunk<T>(arr: T[], size: number): T[][] {
          const out: T[][] = []
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
          return out
        }

        // Per-chat stats
        const perChat: Array<{ chatId: string; exists: boolean; toDelete: { chat: number; messages: number } }> = []
        for (const id of chatIds) {
          const chatCountRow = db.prepare("SELECT COUNT(1) AS c FROM chat WHERE id=?").get(id) as { c: number }
          const msgCountRow = db.prepare("SELECT COUNT(1) AS c FROM message WHERE chatId=?").get(id) as { c: number }
          perChat.push({
            chatId: id,
            exists: (chatCountRow?.c || 0) > 0,
            toDelete: { chat: chatCountRow?.c || 0, messages: msgCountRow?.c || 0 },
          })
        }

        const totals = perChat.reduce(
          (acc, r) => {
            acc.chat += r.toDelete.chat
            acc.messages += r.toDelete.messages
            return acc
          },
          { chat: 0, messages: 0 }
        )

        if (dryRun) {
          const text = JSON.stringify({
            status: "ok",
            dryRun: true,
            chatIds,
            perChat,
            totals,
            notes: [
              "This tool only deletes DB rows (message, chat).",
              "No filesystem cleanup is performed for generatedFiles or attachments.",
            ],
          })
          return { content: [{ type: "text", text }] }
        }

        // Transactional bulk delete (chunked IN clauses)
        const deleted = db.transaction((ids: string[]) => {
          let deletedMessages = 0
          let deletedChats = 0
          // Delete messages in chunks
          for (const part of chunk(ids, 400)) {
            const placeholders = part.map(() => "?").join(",")
            const stmt = db.prepare(`DELETE FROM message WHERE chatId IN (${placeholders})`)
            const res = stmt.run(...part)
            deletedMessages += res?.changes || 0
          }
          // Delete chats in chunks
          for (const part of chunk(ids, 400)) {
            const placeholders = part.map(() => "?").join(",")
            const stmt = db.prepare(`DELETE FROM chat WHERE id IN (${placeholders})`)
            const res = stmt.run(...part)
            deletedChats += res?.changes || 0
          }
          return { messages: deletedMessages, chat: deletedChats }
        })(chatIds)

        const text = JSON.stringify({
          status: "ok",
          dryRun: false,
          chatIds,
          deleted,
          perChat,
          totals,
          notes: [
            "Rows deleted within a single transaction.",
            "No filesystem cleanup is performed for generatedFiles or attachments.",
          ],
        })
        return { content: [{ type: "text", text }] }
      } catch (err: any) {
        const text = JSON.stringify({
          status: "error",
          error: err?.message || String(err),
        })
        return { content: [{ type: "text", text }], isError: true }
      } finally {
        db.close()
      }
    }
  )
}
