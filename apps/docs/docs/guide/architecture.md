# Architecture

The runtime follows a three-layer model.

1. Worker entrypoints authenticate, validate, serve static assets, and route requests.
2. Durable Objects coordinate chat sessions, terminal sessions, agent state, and container lifecycle.
3. Containers provide isolated Linux execution with PTY, persistent file systems, and background processes.

All user-facing real-time channels terminate at the Worker before they are handed to the relevant Durable Object.
