import type { SandboxRuntime } from "@/utils/container-session"

// Curated sandbox environments, oriented to the reverse-engineering / security
// researcher (the product's focus). The headline templates are RE workflows;
// the raw runtimes are demoted to "advanced" for power users. Each template
// drives the agent-guided setup flow: it picks a runtime and seeds a
// workflow-specific prompt so the agent provisions the right environment.

export type SandboxTemplate = {
  id: string
  runtime: SandboxRuntime
  pillClass: string
  pillKey: string
  labelKey: string
  descriptionKey: string
  /** Name stored in the session's sandbox metadata. */
  sandboxName: string
  /** Seed prompt for the agent-guided setup chat (not localized). */
  prompt: string
  /** Demoted, non-RE / power-user option shown under "Advanced". */
  advanced?: boolean
}

export const SANDBOX_TEMPLATES: SandboxTemplate[] = [
  {
    id: "detonation",
    runtime: "docker",
    pillClass: "desktop-pill desktop-pill-container",
    pillKey: "sandbox.template.detonation.pill",
    labelKey: "sandbox.template.detonation.label",
    descriptionKey: "sandbox.template.detonation.description",
    sandboxName: "Detonation sandbox",
    prompt:
      "I want a new offline malware detonation sandbox. Create an isolated Docker container with NO network access (offline) from a minimal Linux image using the sandbox tools, keep it isolated, then help me detonate and observe a sample safely.",
  },
  {
    id: "re-toolkit",
    runtime: "docker",
    pillClass: "desktop-pill desktop-pill-container",
    pillKey: "sandbox.template.toolkit.pill",
    labelKey: "sandbox.template.toolkit.label",
    descriptionKey: "sandbox.template.toolkit.description",
    sandboxName: "RE toolkit",
    prompt:
      "I want a new reverse-engineering toolkit sandbox. Create a Docker container preloaded with static-analysis tools (radare2/rizin, capa, YARA, binwalk, file, strings, gdb) using the sandbox tools, then help me triage a binary.",
  },
  {
    id: "ghidra",
    runtime: "docker",
    pillClass: "desktop-pill desktop-pill-container",
    pillKey: "sandbox.template.ghidra.pill",
    labelKey: "sandbox.template.ghidra.label",
    descriptionKey: "sandbox.template.ghidra.description",
    sandboxName: "Ghidra desktop",
    prompt:
      "I want a Ghidra desktop sandbox. Create a Docker sandbox from the openlegion/ghidra image with a graphical display using the sandbox tools, then open Ghidra so I can start reversing.",
  },
  {
    id: "linux-vm",
    runtime: "linux-vm",
    pillClass: "desktop-pill desktop-pill-desktop",
    pillKey: "containers.choose.linuxVm.pill",
    labelKey: "containers.choose.linuxVm.title",
    descriptionKey: "containers.choose.linuxVm.description",
    sandboxName: "Research VM",
    prompt:
      "I want to set up a Linux VM research sandbox on a separate Linux host (a sacrificial tower). Walk me through installing the OpenLegion daemon and Kata on that host with the host-agent scripts, then connecting this app to its daemon.",
  },
  {
    id: "docker-custom",
    runtime: "docker",
    advanced: true,
    pillClass: "desktop-pill desktop-pill-container",
    pillKey: "containers.choose.docker.pill",
    labelKey: "containers.choose.docker.title",
    descriptionKey: "containers.choose.docker.description",
    sandboxName: "Docker sandbox",
    prompt:
      "I want to create a new Docker container sandbox. Help me choose an image and network settings, then create and start it for me using the sandbox tools.",
  },
  {
    id: "kubernetes",
    runtime: "kubernetes",
    advanced: true,
    pillClass: "desktop-pill desktop-pill-kubernetes",
    pillKey: "containers.choose.kubernetes.pill",
    labelKey: "containers.choose.kubernetes.title",
    descriptionKey: "containers.choose.kubernetes.description",
    sandboxName: "Kubernetes sandbox",
    prompt:
      "I want to create a new Kubernetes sandbox. Help me choose an image, then create it as a workload on the local kind cluster using the sandbox tools.",
  },
]

export function templateById(id: string) {
  return SANDBOX_TEMPLATES.find((item) => item.id === id)
}
