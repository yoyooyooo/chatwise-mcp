import Database from "better-sqlite3"
import fs from "node:fs"
import { resolveDatabasePath } from "./databasePath"
import { formatTimestampFromNumber, rolePrefix, formatToolSections } from "./utils/format.ts"

interface GetSingleChatOptions {
  chatId: string
  dbPath?: string
  includeTools?: boolean
}

export function getSingleChatById(options: GetSingleChatOptions): string {
  const { chatId } = options
  const includeTools = options.includeTools ?? true

  if (!chatId || chatId.trim() === "") {
    throw new Error("chatId cannot be empty")
  }

  console.log(`Start processing single chat: ${chatId}`)
  console.time("getSingleChatById time")

  const dbPath = resolveDatabasePath(options.dbPath)

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`)
  }

  const db = Database(dbPath, { readonly: true })

  try {
    let output = ""

    // Chat info
    const chatInfoQuery = `
      SELECT 
        ch.id,
        COALESCE(ch.title, '<Untitled>') AS title,
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
      throw new Error(`Chat not found: ${chatId}`)
    }

    // Output Chat Info
    output += `Chat Info:\n`
    output += `- ID: ${chatInfo.id}\n`
    output += `- Title: ${chatInfo.title}\n`
    output += `- Message Count: ${chatInfo.message_count}\n`
    if (chatInfo.min_ts && chatInfo.max_ts) {
      output += `- Time Range: ${formatTimestampFromNumber(chatInfo.min_ts)} ~ ${formatTimestampFromNumber(chatInfo.max_ts)}\n`
    }
    output += "---\n"

    // Fetch all messages
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
      output += "No messages in this chat\n"
    } else {
      output += "Messages:\n"
      messages.forEach((msg) => {
        const timestamp = formatTimestampFromNumber(msg.createdAt)
        const prefix = rolePrefix(msg.role)
        output += `[#${msg.message_number}](${msg.id.substring(0, 8)} ${timestamp}) ${prefix}${msg.content}\n`

        if (includeTools && msg.meta) {
          const toolBlocks = formatToolSections(msg.meta)
          if (toolBlocks) output += toolBlocks
        }
      })
    }

    console.timeEnd("getSingleChatById time")
    console.log("Single chat processed")
    return output.trim()
  } finally {
    db.close()
  }
}
