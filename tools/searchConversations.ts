import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import Database from "better-sqlite3"
import fs from "node:fs"
import { resolveDatabasePath } from "../databasePath.js"

type TimeWindow = "7d" | "30d" | "60d" | "90d" | "all"

function nowMs() {
  return Date.now()
}

function parseTimeWindow(tw?: TimeWindow | { start: number; end: number }): {
  startMs: number
  endMs: number
} {
  if (!tw || tw === "all") {
    return { startMs: 0, endMs: 9999999999999 }
  }
  if (typeof tw === "object") return { startMs: tw.start, endMs: tw.end }
  const endMs = nowMs()
  const days = tw === "7d" ? 7 : tw === "30d" ? 30 : tw === "60d" ? 60 : 90
  const startMs = endMs - days * 24 * 60 * 60 * 1000
  return { startMs, endMs }
}

function tokenize(q: string): string[] {
  const s = q.toLowerCase().trim()
  if (!s) return []
  // split on non-alphanum and CJK punctuation; keep simple for robustness
  const tokens = s
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter(Boolean)
  // limit to avoid too many LIKEs
  return tokens.slice(0, 8)
}

function clamp(x: number, a = 0, b = 1) {
  return Math.max(a, Math.min(b, x))
}

export function registerSearchConversationsTool(server: McpServer) {
  server.tool(
    "search_conversations",
    `Search ChatWise conversations by intent (from the local ChatWise SQLite database).

<usecase>
Perfect for:
- Finding relevant conversations by a single keyword or fuzzy intent (e.g., "rust", "生活/日常"), with optional recent time windows
- Preparing candidate chats for follow-up with gather_chats
Examples: "最近两个月关于 rust 的讨论", "最近一个月是否有生活类话题"
</usecase>

<behavior>
- Aggregates matches by conversation (chat-level results)
- Searches across chat title, message content, and tool output text (parsed from message.meta) by default
- Returns structured JSON for LLM consumption: topChatIds, per-chat hits/timeRange, and per-chat snippets (each snippet marks its source: content/title/tool)
</behavior>

<parameters>
- intent_query (string|string[]): Fuzzy intent/keyword or an array of keywords/phrases (e.g., ["idea","想法"]) 
- time_window (optional): '7d'|'30d'|'60d'|'90d'|'all' | { start:number; end:number } (default 'all')
- precision_mode (optional): 'basic'|'fuzzy' (default 'basic'; switch when needed)
- include_tools_in_search (optional): boolean (default true)
- exclude_terms (optional): string[] (default [])
- exclude_chat_ids (optional): string[] (default []); Chat IDs to exclude (e.g., current conversation)
 - user_only (optional): boolean (default false); when true, restrict search to user messages only (excludes assistant/tool and ignores chat title)
- match (optional): 'any'|'all' (default 'any')
- limit_chats (optional): number (default 10)
- limit_snippets_per_chat (optional): number (default 3)
- snippet_window (optional): number (default 64)
</parameters>

<instructions>
1. Provide an intent_query; optionally add time_window (e.g., '60d')
2. The tool returns a JSON object designed for LLMs (contains topChatIds and snippets)
3. Call gather_chats with the returned topChatIds to pull full timelines as needed
</instructions>`,
    {
      intent_query: z
        .union([z.string(), z.array(z.string()).nonempty()])
        .describe("Fuzzy intent/keyword or an array of keywords/phrases to search across chats"),
      time_window: z
        .union([
          z.literal("7d"),
          z.literal("30d"),
          z.literal("60d"),
          z.literal("90d"),
          z.literal("all"),
          z.object({ start: z.number(), end: z.number() }),
        ])
        .optional()
        .describe("Time window to search. Default: 'all'."),
      precision_mode: z
        .enum(["basic", "fuzzy"])
        .optional()
        .describe("'basic' (default) or 'fuzzy' (LLM decides when to switch)"),
      include_tools_in_search: z
        .boolean()
        .optional()
        .describe(
          "Include tool outputs (from message.meta) in search. Default: true."
        ),
      exclude_terms: z
        .array(z.string())
        .optional()
        .describe("Negative terms to exclude. Default: []."),
      exclude_chat_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Chat IDs to exclude from results (e.g., the current conversation). Default: []."
        ),
      user_only: z
        .boolean()
        .optional()
        .describe(
          "When true, search only user messages (excludes assistant/tool; chat title is not searched). Default: false."
        ),
      match: z
        .enum(["any", "all"])
        .optional()
        .describe("Match ANY (default) or ALL terms."),
      limit_chats: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Max chats to return. Default: 10."),
      limit_snippets_per_chat: z
        .number()
        .int()
        .positive()
        .max(10)
        .optional()
        .describe("Max snippets per chat. Default: 3."),
      snippet_window: z
        .number()
        .int()
        .positive()
        .max(400)
        .optional()
        .describe("Snippet window around hit. Default: 64."),
    },
    async (args) => {
      const intentArg = args.intent_query as string | string[]
      const intent = Array.isArray(intentArg) ? intentArg.join(" ") : String(intentArg || "").trim()
      const precision = (args.precision_mode as string) || "basic"
      const includeTools =
        (args.include_tools_in_search as boolean | undefined) ?? true
      const excludeTerms = ((args.exclude_terms as string[] | undefined) || [])
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean)
      const excludeChatIds = ((args.exclude_chat_ids as string[] | undefined) || [])
        .map((id) => String(id).trim())
        .filter(Boolean)
      const matchMode = ((args.match as string) || "any") as "any" | "all"
      const userOnly = (args.user_only as boolean | undefined) ?? false
      const limitChats = (args.limit_chats as number | undefined) ?? 10
      const limitSnippets =
        (args.limit_snippets_per_chat as number | undefined) ?? 3
      const snippetWindow = (args.snippet_window as number | undefined) ?? 64
      const { startMs, endMs } = parseTimeWindow(args.time_window as any)

      // Prepare DB
      const dbPath = resolveDatabasePath(process.env.CHATWISE_DB_PATH)
      if (!fs.existsSync(dbPath)) {
        const text = JSON.stringify({
          status: "error",
          error: `Database not found: ${dbPath}`,
        })
        return { content: [{ type: "text", text }] }
      }
      const db = Database(dbPath, { readonly: true })

      try {
        let terms: string[]
        if (Array.isArray(intentArg)) {
          terms = intentArg
            .map((t) => String(t).toLowerCase().trim())
            .filter(Boolean)
        } else {
          terms = tokenize(intent)
        }
        // cap total term count to avoid oversized WHERE
        if (terms.length > 12) terms = terms.slice(0, 12)
        if (terms.length === 0) {
          const text = JSON.stringify({
            status: "ok",
            iterations_used: 1,
            confidence: 0,
            topChatIds: [],
            results: [],
            guidance: {
              stopIf: "no terms",
              nextActions: [],
              state: {
                expandedTerms: {},
                excludes: excludeTerms,
                iteration: 1,
              },
            },
          })
          return { content: [{ type: "text", text }] }
        }

        const likeParams: string[] = []
        const exclParams: string[] = []
        const termConds = terms.map(() => "text_lower LIKE ?")
        terms.forEach((t) => likeParams.push(`%${t}%`))
        const exclConds = excludeTerms.map(() => "text_lower NOT LIKE ?")
        excludeTerms.forEach((t) => exclParams.push(`%${t}%`))

        // Build dynamic WHERE for terms
        const matchClause =
          matchMode === "all" ? termConds.join(" AND ") : termConds.join(" OR ")
        const excludeClause = exclConds.length
          ? " AND " + exclConds.join(" AND ")
          : ""
        const excludeChatsClause = excludeChatIds.length
          ? ` AND chatId NOT IN (${excludeChatIds.map(() => "?").join(",")})`
          : ""

        // Time window: support ms/sec dual
        const timeClause =
          "((createdAt BETWEEN ? AND ?) OR (createdAt BETWEEN ? AND ?))"

        // Build source CTE parts based on userOnly/includeTools
        const sourceParts: string[] = []
        const timeParamsCounts: number[] = [] // count of timeClause params per part
        if (!userOnly) {
          sourceParts.push(
            `SELECT 'title' AS source, ch.id AS chatId, NULL AS messageId,
                    COALESCE(ch.lastReplyAt, ch.createdAt) AS createdAt,
                    NULL AS role,
                    lower(COALESCE(ch.title,'')) AS text_lower,
                    COALESCE(ch.title,'') AS orig_text
             FROM chat ch
             WHERE ${timeClause}`
          )
          timeParamsCounts.push(4)
        }
        // content (messages)
        sourceParts.push(
          `SELECT 'content' AS source, m.chatId AS chatId, m.id AS messageId, m.createdAt AS createdAt,
                  m.role AS role,
                  lower(COALESCE(m.content,'')) AS text_lower,
                  COALESCE(m.content,'') AS orig_text
           FROM message m
           WHERE ${timeClause}${userOnly ? " AND m.role='user'" : ""}`
        )
        timeParamsCounts.push(4)
        // tool (meta)
        if (includeTools && !userOnly) {
          sourceParts.push(
            `SELECT 'tool' AS source, m.chatId AS chatId, m.id AS messageId, m.createdAt AS createdAt, m.role AS role,
                    lower(COALESCE(m.meta,'')) AS text_lower,
                    COALESCE(m.meta,'') AS orig_text
             FROM message m
             WHERE ${timeClause}`
          )
          timeParamsCounts.push(4)
        }

        const sourcesSql = sourceParts.join("\nUNION ALL\n")

        const baseSql = `
          WITH s AS (
            ${sourcesSql}
          ),
          f AS (
            SELECT * FROM s WHERE (${matchClause})${excludeClause}${excludeChatsClause}
          ),
          agg AS (
            SELECT chatId,
                   MIN(createdAt) AS min_ts,
                   MAX(createdAt) AS max_ts,
                   COUNT(*) AS hits
            FROM f
            GROUP BY chatId
          ),
          top AS (
            SELECT a.chatId, a.hits, a.min_ts, a.max_ts, COALESCE(ch.title,'') AS title
            FROM agg a JOIN chat ch ON ch.id=a.chatId
            ORDER BY a.hits DESC, a.max_ts DESC
            LIMIT ?
          )
          SELECT * FROM top
        `

        // Build positional params in query order: title time, content time, (tool time), then match terms, excludes, then limit
        const timeParams = [startMs, endMs, Math.floor(startMs / 1000), Math.floor(endMs / 1000)]
        const baseParams: any[] = []
        timeParamsCounts.forEach(() => baseParams.push(...timeParams))
        baseParams.push(...likeParams)
        baseParams.push(...exclParams)
        baseParams.push(...excludeChatIds)
        baseParams.push(limitChats)

        // Execute base aggregation
        const stmt = db.prepare(baseSql)
        const rows = stmt.all(...baseParams) as Array<{
          chatId: string
          hits: number
          min_ts: number
          max_ts: number
          title: string
        }>

        const topChatIds = rows.map((r) => r.chatId)

        // Fetch snippets for top chats
        let snippets: Array<{
          source: string
          chatId: string
          messageId: string | null
          createdAt: number
          role: string | null
          orig_text: string
        }> = []

        if (topChatIds.length > 0) {
          const placeholders = topChatIds.map(() => "?").join(",")
          // Build sources for snippet query (mirror base sources)
          const sourcesSql2 = sourcesSql
          const snippetSql = `
            WITH s AS (
              ${sourcesSql2}
            ),
            f AS (
              SELECT * FROM s WHERE chatId IN (${placeholders}) AND (${matchClause})${excludeClause}
            ),
            ranked AS (
              SELECT f.*, ROW_NUMBER() OVER (PARTITION BY chatId ORDER BY createdAt DESC) AS rn
              FROM f
            )
            SELECT source, chatId, messageId, createdAt, role, orig_text
            FROM ranked
            WHERE rn <= ?
            ORDER BY chatId, createdAt DESC
          `
          const snippetParamsArr: any[] = []
          timeParamsCounts.forEach(() => snippetParamsArr.push(...timeParams))
          // then chatIds placeholders
          // then match terms and excludes and limit
          const finalParams = [
            ...snippetParamsArr,
            ...topChatIds,
            ...likeParams,
            ...exclParams,
            limitSnippets,
          ]
          const snippetStmt = db.prepare(snippetSql)
          const res = snippetStmt.all(...finalParams) as any[]
          snippets = res.map((r) => ({
            source: r.source,
            chatId: r.chatId,
            messageId: r.messageId,
            createdAt: r.createdAt,
            role: r.role,
            orig_text: r.orig_text,
          }))
        }

        // Build result objects per chat with snippets
        const results = rows.map((r) => {
          const chatSnips = snippets
            .filter((s) => s.chatId === r.chatId)
            .slice(0, limitSnippets)
          const snipObjs = chatSnips.map((s) => {
            let text = s.orig_text || ""
            // Truncate to snippet window around first matching term
            const lower = text.toLowerCase()
            let hitIdx = -1
            for (const t of terms) {
              const idx = lower.indexOf(t)
              if (idx >= 0) {
                hitIdx = idx
                break
              }
            }
            if (hitIdx < 0) hitIdx = 0
            const start = Math.max(0, hitIdx - snippetWindow)
            const end = Math.min(text.length, hitIdx + snippetWindow)
            let snippet = text.substring(start, end)
            if (start > 0) snippet = "…" + snippet
            if (end < text.length) snippet = snippet + "…"
            const source: "content" | "title" | "tool" =
              s.source === "title"
                ? "title"
                : s.source === "tool"
                ? "tool"
                : "content"
            return {
              messageId: s.messageId || "",
              role: s.role || "",
              createdAt: s.createdAt,
              text: snippet,
              source,
            }
          })
          return {
            chatId: r.chatId,
            title: r.title,
            hits: r.hits,
            timeRange: { from: r.min_ts, to: r.max_ts },
            snippets: snipObjs,
          }
        })

        // Simple confidence heuristic
        let confidence = 0
        if (results.length > 0) {
          const topHits = results[0].hits || 0
          confidence = clamp(
            0.3 + 0.4 * clamp(topHits / 5) + 0.2 * clamp(results.length / 3)
          )
        } else {
          confidence = 0
        }

        const response = {
          status: "ok",
          iterations_used: 1,
          confidence,
          topChatIds,
          results,
          guidance: {
            stopIf: "confidence >= 0.75 || topChatIds.length <= 2",
            nextActions:
              results.length > 0
                ? [
                    {
                      tool: "gather_chats",
                      args: {
                        chatIds: topChatIds.slice(
                          0,
                          Math.max(1, Math.min(3, topChatIds.length))
                        ),
                        includeTools: false,
                      },
                      why: "Pull full context for top candidates while minimizing tokens; enable includeTools=true later if needed",
                    },
                  ]
                : [
                    {
                      tool: "search_conversations",
                      args: {
                        intent_query: intent,
                        precision_mode:
                          precision === "basic" ? "fuzzy" : "basic",
                      },
                      why: "Try alternate precision mode",
                    },
                  ],
            state: {
              expandedTerms: { terms },
              excludes: excludeTerms,
              iteration: 1,
            },
          },
        }

        return { content: [{ type: "text", text: JSON.stringify(response) }] }
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
