import { describe, expect, test } from "bun:test"
import { parseContainerExec, parseSerialConsoleCommand } from "./container-pty"

describe("parseContainerExec", () => {
  test("parses docker exec commands", () => {
    expect(parseContainerExec("docker exec -it abc123 sh")).toEqual({
      runtime: "docker",
      containerId: "abc123",
      shell: ["sh"],
    })
  })

  test("parses podman exec commands", () => {
    expect(parseContainerExec("podman exec -i workload /bin/sh")).toEqual({
      runtime: "podman",
      containerId: "workload",
      shell: ["/bin/sh"],
    })
  })

  test("rejects unsupported commands", () => {
    expect(parseContainerExec("bash -lc echo")).toBeUndefined()
  })
})

describe("parseSerialConsoleCommand", () => {
  test("parses socat serial console commands", () => {
    expect(parseSerialConsoleCommand('socat STDIO,raw,echo=0 UNIX-CONNECT:"/tmp/serial.sock"')).toEqual({
      runtime: "socat",
      args: ["STDIO,raw,echo=0", "UNIX-CONNECT:/tmp/serial.sock"],
    })
  })

  test("parses nc serial console commands", () => {
    expect(parseSerialConsoleCommand('nc -U "/tmp/serial.sock"')).toEqual({
      runtime: "nc",
      args: ["-U", "/tmp/serial.sock"],
    })
  })

  test("rejects unsupported commands", () => {
    expect(parseSerialConsoleCommand("bash -lc echo")).toBeUndefined()
  })
})
