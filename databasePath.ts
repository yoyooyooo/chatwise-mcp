import os from "node:os"
import path from "node:path"

/**
 * 解析数据库路径：优先显式参数，其次环境变量，最后回退到默认路径。
 * 同时将最终路径写回到 CHATWISE_DB_PATH 以便其他模块复用。
 */
export function resolveDatabasePath(explicitPath?: string): string {
  const cleanedExplicit = explicitPath?.trim()
  if (cleanedExplicit) {
    const absolute = path.resolve(cleanedExplicit)
    process.env.CHATWISE_DB_PATH = absolute
    if (!process.env.DB_PATH) {
      process.env.DB_PATH = absolute
    }
    return absolute
  }

  const envPath = (process.env.CHATWISE_DB_PATH || process.env.DB_PATH || "").trim()
  const finalPath = envPath
    ? path.resolve(envPath)
    : path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "app.chatwise",
        "app.db"
      )

  process.env.CHATWISE_DB_PATH = finalPath
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = finalPath
  }

  return finalPath
}
