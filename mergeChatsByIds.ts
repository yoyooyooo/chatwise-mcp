import Database from "better-sqlite3"
import fs from "node:fs"
import { resolveDatabasePath } from "./databasePath"
import { rolePrefix, formatToolSections, formatTimestampFromNumber } from "./utils/format.ts"

interface MergeChatsOptions {
  chatIds: string[]
  dbPath?: string
  includeTools?: boolean
}

export function mergeChatsByIds(options: MergeChatsOptions): string {
  const { chatIds } = options
  const includeTools = options.includeTools ?? true

  // 参数验证
  if (!chatIds || chatIds.length < 2) {
    throw new Error("至少需要提供2个chatId")
  }

  console.log(`开始处理 chatIds: ${JSON.stringify(chatIds)}`)
  console.time("mergeChatsByIds执行时间")

  // 数据库路径处理
  const dbPath = resolveDatabasePath(options.dbPath)

  if (!fs.existsSync(dbPath)) {
    throw new Error(`找不到数据库: ${dbPath}`)
  }

  const db = Database(dbPath, { readonly: true })

  try {
    // 构造VALUES语句
    const valuesClause = chatIds
      .map((id) => `('${id.replace(/'/g, "''")}')`)
      .join(",")

    let output = ""

    // Instruction (English)
    output +=
      "Instruction: You will see raw timelines for multiple chats, followed by a common alignment section that lists messages present in all chats with references.\n- Narrative: keep coreference, progression, and corrections per chat timeline\n- Common alignment: use [Common] items to reference indices from each chat (e.g., 1#3 means chat 1, item 3), summarize shared conclusions and differences.\n"
    output += "---\n"
    output += "Meta:\n"

    // 元信息查询
    const metaQuery = `
      WITH chats(id) AS (VALUES ${valuesClause}),
      info AS (
        SELECT ROW_NUMBER() OVER () AS idx, c.id,
               COALESCE(ch.title,'<Untitled>') AS title,
               MIN(m.createdAt) AS min_ts,
               MAX(m.createdAt) AS max_ts
        FROM chats c
        LEFT JOIN chat ch ON ch.id=c.id
        LEFT JOIN message m ON m.chatId=c.id
        GROUP BY c.id
      )
      SELECT '- Chat ' || idx || ': ' || id || ' | Title: ' || title || ' | Time: '
        || CASE WHEN min_ts>1000000000000 THEN datetime(min_ts/1000,'unixepoch') ELSE datetime(min_ts,'unixepoch') END
        || ' ~ '
        || CASE WHEN max_ts>1000000000000 THEN datetime(max_ts/1000,'unixepoch') ELSE datetime(max_ts,'unixepoch') END
        || char(30)
      FROM info
      ORDER BY idx
    `

    const metaResults = db.prepare(metaQuery).all() as {
      [key: string]: string
    }[]
    metaResults.forEach((row) => {
      const info = Object.values(row)[0]
      output += info.replace(/\x1e/g, "\n") + "\n"
    })

    output += "---\n"
    output += "Per-Chat Narrative:\n"

    // 获取会话头部并合并到消息输出中
    const messagesWithHeadersQuery = `
      WITH chats(id) AS (VALUES ${valuesClause}),
      info AS (
        SELECT ROW_NUMBER() OVER () AS chat_idx, c.id,
               COALESCE(ch.title,'<Untitled>') AS title
        FROM chats c
        LEFT JOIN chat ch ON ch.id=c.id
      ),
      msgs AS (
        SELECT i.chat_idx, m.chatId, m.id AS msg_id,
               ROW_NUMBER() OVER (PARTITION BY m.chatId ORDER BY m.createdAt, m.id) AS rn,
               m.createdAt AS ts_raw,
               CASE WHEN m.createdAt>1000000000000 THEN datetime(m.createdAt/1000,'unixepoch') ELSE datetime(m.createdAt,'unixepoch') END AS ts_human,
               m.role, m.content
        FROM message m
        JOIN info i ON i.id=m.chatId
      )
      SELECT '—— Chat ' || chat_idx || ' ——' || char(30)
      FROM (SELECT DISTINCT chat_idx FROM msgs) d
      ORDER BY chat_idx
    `

    const headerResults = db.prepare(messagesWithHeadersQuery).all() as {
      [key: string]: string
    }[]
    headerResults.forEach((row) => {
      const header = Object.values(row)[0]
      output += header.replace(/\x1e/g, "\n") + "\n"
    })

    // 获取所有消息（返回数值时间戳，统一在 TS 中格式化；附带 meta 用于 includeTools 展示）
    const messagesQuery = `
      WITH chats(id) AS (VALUES ${valuesClause}),
      info AS (
        SELECT ROW_NUMBER() OVER () AS chat_idx, c.id FROM chats c
      ),
      msgs AS (
        SELECT i.chat_idx, m.chatId, m.id AS msg_id,
               ROW_NUMBER() OVER (PARTITION BY m.chatId ORDER BY m.createdAt, m.id) AS rn,
               m.createdAt AS ts_raw,
               m.role, m.content, m.meta
        FROM message m JOIN info i ON i.id=m.chatId
      )
      SELECT chat_idx, rn, msg_id, ts_raw, role, content, meta
      FROM msgs
      ORDER BY chat_idx, rn
    `

    const messages = db.prepare(messagesQuery).all() as {
      chat_idx: number
      rn: number
      msg_id: string
      ts_raw: number
      role: string
      content: string
      meta?: string | null
    }[]

    messages.forEach((msg) => {
      const prefix = rolePrefix(msg.role)
      // 统一在 TS 层格式化时间
      const tsHuman = formatTimestampFromNumber(msg.ts_raw)
      output += `[${msg.chat_idx}#${msg.rn}](${msg.msg_id.substring(0, 8)} ${tsHuman}) ${prefix}${msg.content}\n`

      if (includeTools && msg.meta) {
        const toolBlocks = formatToolSections(msg.meta)
        if (toolBlocks) output += toolBlocks
      }
    })

    output += "---\n"
    output += "Common Alignment (present in all chats, shown once, with refs to indices):\n"

    // 公共消息查询：返回结构化字段，在 TS 中统一渲染
    const commonQuery = `
      WITH chats(id) AS (VALUES ${valuesClause}),
      info AS (
        SELECT ROW_NUMBER() OVER () AS chat_idx, c.id FROM chats c
      ),
      msgs AS (
        SELECT i.chat_idx, m.chatId, m.id AS msg_id,
               ROW_NUMBER() OVER (PARTITION BY m.chatId ORDER BY m.createdAt, m.id) AS rn,
               m.createdAt AS ts,
               m.role, m.content,
               lower(m.role) AS role_n,
               trim(replace(replace(replace(lower(m.content), char(13), ''), char(10), ' '), char(9), ' ')) AS base_n
        FROM message m JOIN info i ON i.id=m.chatId
      ),
      msgs2 AS (
        SELECT chat_idx, chatId, msg_id, rn, ts, role, content,
               role_n,
               replace(replace(replace(replace(replace(base_n,'  ',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ') AS cont_n
        FROM msgs
      ),
      sigs AS (
        SELECT (role_n||char(31)||cont_n) AS sig, COUNT(DISTINCT chatId) AS cnt, MIN(ts) AS min_ts FROM msgs2 GROUP BY sig
      ),
      total AS (SELECT COUNT(*) AS n FROM chats)
      SELECT 
        (SELECT role FROM msgs2 x WHERE (x.role_n||char(31)||x.cont_n)=(m.role_n||char(31)||m.cont_n) ORDER BY x.ts LIMIT 1) AS role_first,
        (SELECT content FROM msgs2 x WHERE (x.role_n||char(31)||x.cont_n)=(m.role_n||char(31)||m.cont_n) ORDER BY x.ts LIMIT 1) AS content_first,
        s.min_ts AS min_ts,
        (
          SELECT group_concat(m2.chat_idx||'#'||m2.rn||'('||substr(m2.msg_id,1,8)||')' , ',')
          FROM msgs2 m2 WHERE (m2.role_n||char(31)||m2.cont_n)=(m.role_n||char(31)||m.cont_n) ORDER BY m2.chat_idx
        ) AS refs
      FROM msgs2 m
      JOIN sigs s ON s.sig=(m.role_n||char(31)||m.cont_n)
      JOIN total t ON 1=1
      WHERE s.cnt = t.n
      GROUP BY (m.role_n||char(31)||m.cont_n)
      ORDER BY s.min_ts
    `

    const commonMessages = db.prepare(commonQuery).all() as {
      role_first: string
      content_first: string
      min_ts: number
      refs: string
    }[]
    commonMessages.forEach((row) => {
      const prefix = rolePrefix(row.role_first)
      output += `[Common]${prefix}${row.content_first}  | Refs: ${row.refs}\n`
    })

    console.timeEnd("mergeChatsByIds time")
    console.log("Processing complete, returning result")
    return output.trim()
  } finally {
    db.close()
  }
}
