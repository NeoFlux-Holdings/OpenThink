# Cloudflare Token

For live automated provisioning, create an account-scoped API token with the narrowest permissions needed for the resources you want `open-think` to manage.

Required account permissions:

| Permission | Why |
| --- | --- |
| Workers Scripts Edit / Write | Upload and update the Worker control plane bundle. |
| Containers Edit / Write | Create and update Container-backed agent runtimes. |
| D1 Edit / Write | Create deployment metadata databases and apply migrations. |
| Workers R2 Storage Edit / Write | Create artifact and snapshot buckets. |
| Queues Edit / Write | Create task queues for deployment and agent work. |
| Vectorize Edit / Write | Create semantic memory indexes. |
| Workers AI Read | Run the default Cloudflare-hosted model and memory embeddings. |
| Browser Rendering Edit | Capture Browser Run `/snapshot` artifacts and open Browser Run CDP sessions for visual inspection and Live View takeover. |
| Access Apps and Policies Edit / Write | Create the Access application and owner email allow policy for each deployed Worker. |
| Account Settings Read | Read account-level Workers metadata, including the account Workers subdomain. |
| User Details Read | Let Cloudflare Dashboard validate the token owner during token creation. |

Optional account permissions:

| Permission | Why |
| --- | --- |
| Artifacts Edit / Write | Create the optional per-agent Git workspace used for self-evolving code changes. |
| Containers Edit / Write or Cloudchamber Edit / Write | Enable Cloudflare Sandbox and Container-backed execution planes on paid accounts. |
| AI Gateway Read/Edit/Run | Route external model providers through AI Gateway. |
| Cloudflare Pages Edit / Write | Let the agent create and update Pages frontends for app deployments. |
| Workers KV Storage Edit / Write | Let the agent provision KV namespaces for apps that need low-latency key-value state. |
| Registrar Edit / Write | Check and register new domains through the Cloudflare Registrar beta API. Add manually when the deploy form's domain availability check reports that Registrar permission is missing. |

Optional zone permissions for custom agent domains:

| Permission | Why |
| --- | --- |
| Zone Read | List zones and validate that the selected custom hostname belongs to the account. |
| DNS Edit / Write | Create or update the CNAME for the custom agent subdomain. |
| Workers Routes Edit / Write | Attach deployed agents to custom zone routes. |

Cloudflare publishes the current token permission list in its API token permissions reference. If a permission name changes between dashboard and API wording, use the equivalent `Write` permission in API-token form.

The `/deploy` self-service form includes a `Create scoped token` button that preloads Cloudflare Dashboard with the launch permissions plus the optional capabilities the default personal agent can use after launch. Users still approve and create the token inside Cloudflare; `open-think` cannot silently mint a user token without Cloudflare OAuth, partner provisioning, or a separate token-creation grant.

For R2, the Cloudflare template key is `workers_r2`, and the Dashboard should show `Account > Workers R2 Storage > Edit`. Tokens created from older links that used `workers_r2_storage` will fail provisioning at the R2 read/create step.
