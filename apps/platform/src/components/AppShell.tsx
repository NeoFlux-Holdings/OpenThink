import { Navigation } from "./Navigation";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-frame">
      <Navigation />
      <main className="app-main">{children}</main>
    </div>
  );
}
