# Security

Security responsibilities are split by layer.

- Worker entrypoints validate JWT or Cloudflare Access identity before routing.
- Durable Objects enforce per-user ownership and persist only scoped state.
- Containers run isolated workloads and receive credentials through sidecar-controlled injection.
- MCP servers require scoped OAuth tokens per external service.
- Terminal sessions require Cloudflare Access before a PTY starts.

Self-service deployments fail closed around public reachability. The provisioner enables the Worker's `workers.dev` route only long enough to attach a Cloudflare Access self-hosted application and owner email allow policy; if Access creation fails, the route is disabled again and the launch returns an error.
