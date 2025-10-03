export function formatTimestampFromNumber(ts: number): string {
  // 支持秒/毫秒两种时间戳
  return ts > 1000000000000
    ? new Date(ts).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
    : new Date(ts * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
}

export function rolePrefix(role: string): string {
  return role === 'user' ? 'Me: ' : role === 'assistant' ? 'AI: ' : `[${role}] `
}

export function formatToolSections(metaRaw: string | null | undefined): string {
  if (!metaRaw) return ''
  let meta: any
  try {
    meta = JSON.parse(metaRaw)
  } catch {
    return ''
  }

  if (!meta || (meta.toolCall === undefined && meta.toolResult === undefined)) return ''

  let out = ''

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
        out += `  <Tool Call> ${callKey} server=${server} tool=${tool}\n`
        if (prettyArgs) {
          out += `  <Args>\n${prettyArgs}\n`
        }
      } else {
        try {
          out += `  <Tool Call> ${callKey}: ${JSON.stringify(callVal)}\n`
        } catch {
          out += `  <Tool Call> ${callKey}: ${String(callVal)}\n`
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
        out += `  <Tool Result>\n${joined}\n`
      } else {
        try {
          out += `  <Tool Result (JSON)> ${JSON.stringify(parsedRes, null, 2)}\n`
        } catch {
          out += `  <Tool Result> [Unparseable]\n`
        }
      }
    } else if (parsedRes) {
      try {
        out += `  <Tool Result (JSON)> ${JSON.stringify(parsedRes, null, 2)}\n`
      } catch {
        out += `  <Tool Result> [Unparseable]\n`
      }
    } else if (typeof rawRes === 'string' && rawRes.trim()) {
      out += `  <Tool Result (Raw)> ${rawRes}\n`
    }
  }

  return out
}

