import Polka from "polka"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { registerGatherChatsTool } from "./tools/gatherChats"

const server = new McpServer(
  {
    name: "chatwise-mcp",
    version: "0.0.1",
  },
  {
    capabilities: { logging: {} },
  }
)

registerGatherChatsTool(server)

export async function startServer() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

const port = Number(process.env.PORT || "3000")

export async function startServerWithOptions(
  options: { type: "stdio" } | { type: "sse" }
) {
  if (options.type === "stdio") {
    const transport = new StdioServerTransport()
    await server.connect(transport)
  } else {
    const transports = new Map<string, SSEServerTransport>()
    const app = Polka()

    app.get("/sse", async (req, res) => {
      const transport = new SSEServerTransport("/messages", res)
      transports.set(transport.sessionId, transport)
      res.on("close", () => transports.delete(transport.sessionId))
      await server.connect(transport)
    })

    app.post("/messages", async (req: any, res: any) => {
      const sessionId = (req.query?.sessionId as string) || ""
      const transport = transports.get(sessionId)
      if (!transport) return res.status(400).send("No transport for sessionId")
      await transport.handlePostMessage(req, res)
    })

    app.listen(port)
    console.log(`sse server: http://localhost:${port}/sse`)
  }
}
