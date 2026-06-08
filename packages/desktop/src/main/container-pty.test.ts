import { describe, expect, test } from "bun:test"
import { parseContainerExec } from "./container-pty"

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
