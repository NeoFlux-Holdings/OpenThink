import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import "streamdown/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "open-think beta2",
  description: "Cloudflare-native Personal Agent OS deployment and control plane."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
