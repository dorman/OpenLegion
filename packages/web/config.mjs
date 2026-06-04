const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://openlegion.dev" : `https://${stage}.openlegion.dev`,
  console: stage === "production" ? "https://openlegion.dev/auth" : `https://${stage}.openlegion.dev/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/dorman/OpenLegion",
  discord: "https://openlegion.dev/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
