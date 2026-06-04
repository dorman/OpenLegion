// @ts-nocheck

import { OpenLegion } from "@openlegion-ai/core"
import { ReadTool } from "@openlegion-ai/core/tools"

const openlegion = OpenLegion.make({})

openlegion.tool.add(ReadTool)

openlegion.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

openlegion.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

openlegion.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await openlegion.session.create({
  agent: "build",
})

openlegion.subscribe((event) => {
  console.log(event)
})

await openlegion.session.prompt({
  sessionID,
  text: "hey what is up",
})

await openlegion.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await openlegion.session.wait()

console.log(await openlegion.session.messages(sessionID))
