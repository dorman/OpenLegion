import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

export type ComposeResult = {
  output: string
}

async function composeFetch(server: ServerConnection.HttpBase, path: string, file: string) {
  const headers = new Headers({ "content-type": "application/json" })
  if (server.password) {
    headers.set(
      "authorization",
      `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    )
  }

  const response = await fetch(new URL(path, server.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ file }),
  })

  if (!response.ok) {
    const text = await response.text()
    let message = text
    try {
      const json = JSON.parse(text) as { message?: string; error?: string; data?: { message?: string } }
      message = json.message ?? json.data?.message ?? json.error ?? text
    } catch {}
    throw new Error(message || `Request failed (${response.status})`)
  }

  return (await response.json()) as ComposeResult
}

export async function deployComposeStack(server: ServerConnection.HttpBase, file: string) {
  return composeFetch(server, "/global/compose/up", file)
}

export async function stopComposeStack(server: ServerConnection.HttpBase, file: string) {
  return composeFetch(server, "/global/compose/down", file)
}
