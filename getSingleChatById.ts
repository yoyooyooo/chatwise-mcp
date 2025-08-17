import Database from "better-sqlite3"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"

interface GetSingleChatOptions {
  chatId: string
  dbPath?: string
}

export function getSingleChatById(options: GetSingleChatOptions): string {
  const { chatId } = options

  if (!chatId || chatId.trim() === "") {
    throw new Error("chatId 不能为空")
  }

  console.log(`开始处理单个会话: ${chatId}`)
  console.time("getSingleChatById执行时间")

  const dbPath =
    options.dbPath ||
    process.env.DB_PATH ||
    path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "app.chatwise",
      "app.db"
    )

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
      })
    }

    console.timeEnd("getSingleChatById执行时间")
    console.log("单会话处理完成")
    return output.trim()
  } finally {
    db.close()
  }
}