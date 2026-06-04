/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://openlegion.dev",

  // GitHub
  github: {
    repoUrl: "https://github.com/dorman/OpenLegion",
    starsFormatted: {
      compact: "160K",
      full: "160,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/openlegion",
    discord: "https://discord.gg/openlegion",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "900",
    commits: "13,000",
    monthlyUsers: "7.5M",
  },
} as const
