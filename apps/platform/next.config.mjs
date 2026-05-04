import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: [
    "@open-think/core",
    "@open-think/llm",
    "@open-think/mcp",
    "@open-think/sandbox",
    "@open-think/state",
    "@open-think/storage",
    "@open-think/sync",
    "@open-think/terminal",
    "@open-think/ui"
  ],
  turbopack: {
    root: workspaceRoot
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "imagedelivery.net"
      }
    ]
  }
};

if (
  process.env.npm_lifecycle_event === "dev" &&
  process.env.OPEN_THINK_ENABLE_OPENNEXT_DEV_BRIDGE === "true"
) {
  initOpenNextCloudflareForDev();
}

export default nextConfig;
