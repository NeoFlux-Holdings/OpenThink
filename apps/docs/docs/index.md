# open-think

`open-think` is a Personal Agent OS built on Cloudflare Workers, Durable Objects, Containers, AI, R2, D1, Vectorize, Queues, and MCP.

The platform favors one production launch path today and keeps the other managed paths explicit:

- User-owned Cloudflare launch with scoped token verification and Access lock-down.
- Stripe Projects for zero-touch account creation and spend controls (planned managed onboarding).
- Deploy to Cloudflare for GitHub-backed builders.
- Agentic provisioning for AI coding agents using the Cloudflare API MCP surface.
- Partner API provisioning for white-label tenant ownership.

See also:

- [Hosted Cloud Agent Workflow](./guide/hosted-cloud-agent.md)
- [Product Spec Audit](./guide/product-spec-audit.md)
- [Effect and Executor Workflows](./guide/effect-executor.md)
