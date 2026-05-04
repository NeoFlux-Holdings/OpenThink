# Runtime Packages

Package boundaries keep the runtime swappable:

- `core`: base agent and interfaces.
- `state`: Durable Object state and SQLite-shaped repositories.
- `llm`: Workers AI and AI Gateway adapters.
- `memory`: conversation memory extraction.
- `retrieval`: Vectorize and AutoRAG access.
- `storage`: R2 object IO.
- `tasks`: Queues and Workflows.
- `network`: agent registration.
- `sandbox`: Container lifecycle.
- `mcp`: MCP server and client helpers.
- `terminal`: browser and local terminal primitives.
- `ui`: React hooks for agent, chat, and terminal surfaces.
