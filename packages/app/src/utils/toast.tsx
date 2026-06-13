import { Icon, type IconProps } from "@openlegion-ai/ui/icon"
import { Toast, showToast as showLegacyToast, toaster, type ToastOptions, type ToastVariant } from "@openlegion-ai/ui/toast"
import { ToastV2, showToastV2, toasterV2 } from "@openlegion-ai/ui/v2/toast-v2"

let v2 = false

export function setV2Toast(value: boolean) {
  v2 = value
}

export function ToastRegion(props: { v2: boolean }) {
  if (props.v2) return <ToastV2.Region />
  return <Toast.Region />
}

export function dismissToast(id: number | undefined) {
  if (id === undefined) return
  if (!v2) return toaster.dismiss(id)
  return toasterV2.dismiss(id)
}

export function showToast(options: ToastOptions | string) {
  if (!v2) return showLegacyToast(options)
  if (typeof options === "string") return showToastV2(options)

  return showToastV2({
    ...options,
    icon: resolveIcon(options.icon, options.variant),
    actions: options.actions?.map((action) => ({
      ...action,
      variant: action.onClick === "dismiss" ? "secondary" : "primary",
    })),
  })
}

function resolveIcon(icon: IconProps["name"] | undefined, variant: ToastVariant | undefined) {
  const name = icon ?? (variant === "success" ? "check" : undefined)
  if (!name) return
  return <Icon name={name} />
}
