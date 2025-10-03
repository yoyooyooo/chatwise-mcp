import Database from "better-sqlite3"
import fs from "node:fs"
import { resolveDatabasePath } from "./databasePath"

interface GetSingleChatOptions {
  chatId: string
  dbPath?: string
  includeTools?: boolean
}

export function getSingleChatById(options: GetSingleChatOptions): string {
  const { chatId } = options
  const includeTools = options.includeTools ?? true

  if (!chatId || chatId.trim() === "") {
    throw new Error("chatId 不能为空")
  }

  console.log(`开始处理单个会话: ${chatId}`)
  console.time("getSingleChatById执行时间")

  const dbPath = resolveDatabasePath(options.dbPath)

  if (!fs.existsSync(dbPath)) {
    throw new Error(`找不到数据库: ${dbPath}`)
  }

  const db = Database(dbPath, { readonly: true })

  try {
    let output = ""

    // 获取会话基本信息
    const chatInfoQuery = `
      SELECT 
        ch.id,
        COALESCE(ch.title, '<无标题>') AS title,
        MIN(m.createdAt) AS min_ts,
        MAX(m.createdAt) AS max_ts,
        COUNT(m.id) AS message_count
      FROM chat ch
      LEFT JOIN message m ON m.chatId = ch.id
      WHERE ch.id = ?
      GROUP BY ch.id, ch.title
    `

    const chatInfo = db.prepare(chatInfoQuery).get(chatId) as {
      id: string
      title: string
      min_ts: number
      max_ts: number
      message_count: number
    } | undefined

    if (!chatInfo) {
      throw new Error(`找不到会话: ${chatId}`)
    }

    // 格式化时间戳
    const formatTimestamp = (ts: number) => {
      return ts > 1000000000000 
        ? new Date(ts).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
        : new Date(ts * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
    }

    // 输出会话信息
    output += `会话信息:\n`
    output += `- ID: ${chatInfo.id}\n`
    output += `- 标题: ${chatInfo.title}\n`
    output += `- 消息数量: ${chatInfo.message_count}\n`
    if (chatInfo.min_ts && chatInfo.max_ts) {
      output += `- 时间范围: ${formatTimestamp(chatInfo.min_ts)} ~ ${formatTimestamp(chatInfo.max_ts)}\n`
    }
    output += "---\n"

    // 获取所有消息
    const messagesQuery = `
      SELECT 
        m.id,
        m.createdAt,
        m.role,
        m.content,
        m.meta,
        ROW_NUMBER() OVER (ORDER BY m.createdAt, m.id) AS message_number
      FROM message m
      WHERE m.chatId = ?
      ORDER BY m.createdAt, m.id
    `

    const messages = db.prepare(messagesQuery).all(chatId) as Array<{
      id: string
      createdAt: number
      role: string
      content: string
      meta?: string | null
      message_number: number
    }>

    if (messages.length === 0) {
      output += "该会话暂无消息\n"
    } else {
      output += "消息记录:\n"
      messages.forEach((msg) => {
        const timestamp = formatTimestamp(msg.createdAt)
        const rolePrefix = msg.role === 'user' ? 'Me: ' : 
                          msg.role === 'assistant' ? 'AI: ' : 
                          `[${msg.role}] `
        
        output += `[#${msg.message_number}](${msg.id.substring(0, 8)} ${timestamp}) ${rolePrefix}${msg.content}\n`

        // 工具调用/结果解析（可开关）
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
                    // 尝试将参数字符串解析为 JSON，以提升可读性
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
                  // 不确定结构，直接输出 JSON
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
                  // 回退为 JSON 展示
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
                // 原始字符串直接输出
                output += `  <Tool Result (Raw)> ${rawRes}\n`
              }
            }
          }
        }
      })
    }

    console.timeEnd("getSingleChatById执行时间")
    console.log("单会话处理完成")
    return output.trim()
  } finally {
    db.close()
  }
}
