import { afterEach, describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { Flag } from "@openlegion-ai/core/flag/flag"
import { ServerAuth } from "../../src/server/auth"

const original = {
  OPENLEGION_SERVER_PASSWORD: Flag.OPENLEGION_SERVER_PASSWORD,
  OPENLEGION_SERVER_USERNAME: Flag.OPENLEGION_SERVER_USERNAME,
}

afterEach(() => {
  Flag.OPENLEGION_SERVER_PASSWORD = original.OPENLEGION_SERVER_PASSWORD
  Flag.OPENLEGION_SERVER_USERNAME = original.OPENLEGION_SERVER_USERNAME
})

describe("ServerAuth", () => {
  test("does not emit auth headers without a password", () => {
    Flag.OPENLEGION_SERVER_PASSWORD = undefined
    Flag.OPENLEGION_SERVER_USERNAME = "alice"

    expect(ServerAuth.header()).toBeUndefined()
    expect(ServerAuth.headers()).toBeUndefined()
  })

  test("defaults to the openlegion username", () => {
    Flag.OPENLEGION_SERVER_PASSWORD = "secret"
    Flag.OPENLEGION_SERVER_USERNAME = undefined

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("openlegion:secret").toString("base64")}`,
    })
  })

  test("uses the configured username", () => {
    Flag.OPENLEGION_SERVER_PASSWORD = "secret"
    Flag.OPENLEGION_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    })
  })

  test("prefers explicit credentials", () => {
    Flag.OPENLEGION_SERVER_PASSWORD = "secret"
    Flag.OPENLEGION_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers({ password: "cli-secret", username: "bob" })).toEqual({
      Authorization: `Basic ${Buffer.from("bob:cli-secret").toString("base64")}`,
    })
  })

  test("validates decoded credentials against effect config", () => {
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "openlegion", password: Redacted.make("secret") }, config)).toBe(false)
  })
})
