import markUrl from "../assets/brand/openlegion-mark.base64"
import logoUrl from "../assets/brand/openlegion-logo.base64"

const imgClass = (className: string | undefined) => ({ [className ?? ""]: !!className })

/** Hooded legion mark — circular icon without eyes */
export const Mark = (props: { class?: string; alt?: string }) => {
  const label = props.alt ?? "OpenLegion"
  const decorative = props.alt === ""
  return (
    <img
      data-component="logo-mark"
      src={markUrl}
      alt={decorative ? "" : label}
      aria-hidden={decorative ? true : undefined}
      classList={imgClass(props.class)}
      draggable={false}
    />
  )
}

/** Loading splash emblem */
export const Splash = (props: { ref?: (el: HTMLImageElement) => void; class?: string; alt?: string }) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-splash"
      src={markUrl}
      alt={props.alt ?? "OpenLegion"}
      classList={imgClass(props.class)}
      draggable={false}
    />
  )
}

/** Stacked mark + wordmark for headers and home */
export const Logo = (props: { class?: string; alt?: string }) => {
  return (
    <img
      data-component="logo-wordmark"
      src={logoUrl}
      alt={props.alt ?? "OpenLegion"}
      classList={imgClass(props.class)}
      draggable={false}
    />
  )
}
