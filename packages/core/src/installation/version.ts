declare global {
  const OPENLEGION_VERSION: string
  const OPENLEGION_CHANNEL: string
}

export const InstallationVersion = typeof OPENLEGION_VERSION === "string" ? OPENLEGION_VERSION : "local"
export const InstallationChannel = typeof OPENLEGION_CHANNEL === "string" ? OPENLEGION_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
