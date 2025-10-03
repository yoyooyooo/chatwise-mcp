import Database from "better-sqlite3"
import fs from "node:fs"
import { resolveDatabasePath } from "./databasePath"

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

    // 系统指令
    output +=
      "系统指令: 你将看到多个会话分别按时间线展开的原始记录，然后在末尾给出公共部分的引用对齐。请基于：\n- 逐会话线性叙述：保留指代、递进与修正关系\n- 公共对齐：用 [公共] 项引用到各会话中的索引（如 1#3 表示会话1的第3条），输出共同结论与差异。\n"
    output += "---\n"
    output += "元信息:\n"

    // 元信息查询
    const metaQuery = `
      WITH chats(id) AS (VALUES ${valuesClause}),
      info AS (
        SELECT ROW_NUMBER() OVER () AS idx, c.id,
               COALESCE(ch.title,'<无标题>') AS title,
               MIN(m.createdAt) AS min_ts,
               MAX(m.createdAt) AS max_ts
        FROM chats c
        LEFT JOIN chat ch ON ch.id=c.id
        LEFT JOIN message m ON m.chatId=c.id
        GROUP BY c.id
      )
      SELECT '- 会话' || idx || ': ' || id || ' | 标题: ' || title || ' | 时间: '
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
    output += "逐会话线性叙述:\n"

    // 获取会话头部并合并到消息输出中
    const messagesWithHeadersQuery = `
      WITH chats(id) AS (VALUES ${valuesClause}),
      info AS (
        SELECT ROW_NUMBER() OVER () AS chat_idx, c.id,
               COALESCE(ch.title,'<无标题>') AS title
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
      SELECT '—— 会话' || chat_idx || ' ——' || char(30)
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

    // 获取所有消息（附带 meta，用于 includeTools 展示）
    const messagesQuery = `
      WITH chats(id) AS (VALUES ${valuesClause}),
      info AS (
        SELECT ROW_NUMBER() OVER () AS chat_idx, c.id FROM chats c
      ),
      msgs AS (
        SELECT i.chat_idx, m.chatId, m.id AS msg_id,
               ROW_NUMBER() OVER (PARTITION BY m.chatId ORDER BY m.createdAt, m.id) AS rn,
               m.createdAt AS ts_raw,
               CASE WHEN m.createdAt>1000000000000 THEN datetime(m.createdAt/1000,'unixepoch') ELSE datetime(m.createdAt,'unixepoch') END AS ts_human,
               m.role, m.content, m.meta
        FROM message m JOIN info i ON i.id=m.chatId
      )
      SELECT chat_idx, rn, msg_id, ts_human, role, content, meta
      FROM msgs
      ORDER BY chat_idx, rn
    `

    const messages = db.prepare(messagesQuery).all() as {
      chat_idx: number
      rn: number
      msg_id: string
      ts_human: string
      role: string
      content: string
      meta?: string | null
    }[]

    messages.forEach((msg) => {
      const rolePrefix = msg.role === 'user' ? 'Me: ' : msg.role === 'assistant' ? 'AI: ' : `[${msg.role}] `
      output += `[${msg.chat_idx}#${msg.rn}](${msg.msg_id.substring(0, 8)} ${msg.ts_human}) ${rolePrefix}${msg.content}\n`

      if (includeTools && msg.meta) {
        let meta: any
        try {
          meta = JSON.parse(msg.meta)
        } catch {
          meta = undefined
        }
        if (meta && (meta.toolCall || meta.toolResult)) {
          // 工具调用
          if (meta.toolCall) {
            const callsObj = meta.toolCall
            const entries: [string, any][] = Object.entries(callsObj as any)
            entries.forEach(([callKey, callVal]) => {
              const cv: any = callVal as any
              if (cv && typeof cv === 'object') {
                const server = cv.server_name ?? cv.server ?? ''
                const tool = cv.tool_name ?? cv.tool ?? ''
                const rawArgs = cv.arguments ?? cv.args ?? ''
                let prettyArgs = ''
                if (typeof rawArgs === 'string') {
                  try {
                    const parsed = JSON.parse(rawArgs)
                    prettyArgs = JSON.stringify(parsed, null, 2)
                  } catch {
                    prettyArgs = String(rawArgs)
                  }
                } else {
                  try {
                    prettyArgs = JSON.stringify(rawArgs, null, 2)
                  } catch {
                    prettyArgs = String(rawArgs)
                  }
                }
                output += `  <Tool Call> ${callKey} server=${server} tool=${tool}\n`
                if (prettyArgs) {
                  output += `  <Args>\n${prettyArgs}\n`
                }
              } else {
                try {
                  output += `  <Tool Call> ${callKey}: ${JSON.stringify(callVal)}\n`
                } catch {
                  output += `  <Tool Call> ${callKey}: ${String(callVal)}\n`
                }
              }
            })
          }

          // 工具结果
          if (meta.toolResult !== undefined) {
            const rawRes = meta.toolResult
            let parsedRes: any = undefined
            if (typeof rawRes === 'string') {
              try {
                parsedRes = JSON.parse(rawRes)
              } catch {
                parsedRes = undefined
              }
            } else if (typeof rawRes === 'object' && rawRes !== null) {
              parsedRes = rawRes
            }

            if (parsedRes && parsedRes.content && Array.isArray(parsedRes.content)) {
              const textParts: string[] = []
              for (const c of parsedRes.content) {
                if (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string') {
                  textParts.push(c.text)
                }
              }
              const joined = textParts.join("\n")
              if (joined) {
                output += `  <Tool Result>\n${joined}\n`
              } else {
                try {
                  output += `  <Tool Result (JSON)> ${JSON.stringify(parsedRes, null, 2)}\n`
                } catch {
                  output += `  <Tool Result> [Unparseable]\n`
                }
              }
            } else if (parsedRes) {
              try {
                output += `  <Tool Result (JSON)> ${JSON.stringify(parsedRes, null, 2)}\n`
              } catch {
                output += `  <Tool Result> [Unparseable]\n`
              }
            } else if (typeof rawRes === 'string' && rawRes.trim()) {
              output += `  <Tool Result (Raw)> ${rawRes}\n`
            }
          }
        }
      }
    })

    output += "---\n"
    output += "公共对齐（所有会话都包含，仅展示一次，并引用各会话中的索引）:\n"

    // 公共消息查询
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
      SELECT '[公共]'||
        CASE 
          WHEN (SELECT role FROM msgs2 x WHERE (x.role_n||char(31)||x.cont_n)=(m.role_n||char(31)||m.cont_n) ORDER BY x.ts LIMIT 1) = 'user' THEN 'Me: '
          WHEN (SELECT role FROM msgs2 x WHERE (x.role_n||char(31)||x.cont_n)=(m.role_n||char(31)||m.cont_n) ORDER BY x.ts LIMIT 1) = 'assistant' THEN 'AI: '
          ELSE '['||(SELECT role FROM msgs2 x WHERE (x.role_n||char(31)||x.cont_n)=(m.role_n||char(31)||m.cont_n) ORDER BY x.ts LIMIT 1)||'] '
        END ||
        (SELECT content FROM msgs2 x WHERE (x.role_n||char(31)||x.cont_n)=(m.role_n||char(31)||m.cont_n) ORDER BY x.ts LIMIT 1)||'  | Refs: '
        || (
             SELECT group_concat(m2.chat_idx||'#'||m2.rn||'('||substr(m2.msg_id,1,8)||')' , ',')
             FROM msgs2 m2 WHERE (m2.role_n||char(31)||m2.cont_n)=(m.role_n||char(31)||m.cont_n) ORDER BY m2.chat_idx
           )
        || char(30)
      FROM msgs2 m
      JOIN sigs s ON s.sig=(m.role_n||char(31)||m.cont_n)
      JOIN total t ON 1=1
      WHERE s.cnt = t.n
      GROUP BY (m.role_n||char(31)||m.cont_n)
      ORDER BY s.min_ts
    `

    const commonMessages = db.prepare(commonQuery).all() as {
      [key: string]: string
    }[]
    commonMessages.forEach((row) => {
      const message = Object.values(row)[0]
      output += message.replace(/\x1e/g, "\n") + "\n"
    })

    console.timeEnd("mergeChatsByIds执行时间")
    console.log("处理完成，返回结果")
    return output.trim()
  } finally {
    db.close()
  }
}
