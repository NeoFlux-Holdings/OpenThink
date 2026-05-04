import { defineConfig } from "vitepress";

export default defineConfig({
  title: "open-think",
  description: "Cloudflare-native Personal Agent OS",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/architecture" },
      { text: "Deployment", link: "/guide/deployment" },
      { text: "Security", link: "/guide/security" }
    ],
    sidebar: [
      {
        text: "Platform",
        items: [
          { text: "Architecture", link: "/guide/architecture" },
          { text: "Deployment", link: "/guide/deployment" },
          { text: "Artifacts Sync", link: "/guide/artifacts-sync" },
          { text: "Cloudflare Token", link: "/guide/cloudflare-token" },
          { text: "Runtime Packages", link: "/guide/packages" },
          { text: "Security", link: "/guide/security" }
        ]
      }
    ]
  }
});
