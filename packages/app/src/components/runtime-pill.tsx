import { useLanguage } from "@/context/language"
import type { ContainerRuntimeStatus } from "@/utils/containers"

export function RuntimePill(props: { label: string; ready: boolean; readyLabel: string; unavailableLabel: string }) {
  return (
    <span
      classList={{
        "desktop-pill": true,
        "desktop-pill-success": props.ready,
        "desktop-pill-stopped": !props.ready,
      }}
    >
      {props.label}: {props.ready ? props.readyLabel : props.unavailableLabel}
    </span>
  )
}

/** The standard docker / sandbox daemon / QEMU readiness trio. */
export function RuntimeStatusPills(props: { status: ContainerRuntimeStatus }) {
  const language = useLanguage()
  return (
    <div class="flex flex-wrap gap-2">
      <RuntimePill
        label={language.t("containers.runtime.docker")}
        ready={props.status.docker}
        readyLabel={language.t("containers.runtime.ready")}
        unavailableLabel={language.t("containers.runtime.unavailable")}
      />
      <RuntimePill
        label={language.t("containers.runtime.microvm")}
        ready={props.status.microvm}
        readyLabel={language.t("containers.runtime.ready")}
        unavailableLabel={language.t("containers.runtime.unavailable")}
      />
      <RuntimePill
        label={language.t("containers.runtime.qemu")}
        ready={props.status.qemu}
        readyLabel={language.t("containers.runtime.ready")}
        unavailableLabel={language.t("containers.runtime.unavailable")}
      />
    </div>
  )
}
