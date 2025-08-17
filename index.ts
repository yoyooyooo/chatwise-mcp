import { startServer, startServerWithOptions } from "./server"

const useSse = process.argv.includes("--sse")

if (useSse) {
  startServerWithOptions({ type: "sse" })
} else {
  startServer()
}
