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
| Access Apps and Policies Edit / Write | Create the Access application and owner email allow policy for each deployed Worker. |
| Account Settings Read | Read account-level Workers metadata, including the account Workers subdomain. |
| User Details Read | Let Cloudflare Dashboard validate the token owner during token creation. |

Optional account permissions:

| Permission | Why |
| --- | --- |
| Workers AI Read or Edit / Write | Run default Workers AI models when no AI Gateway is configured. |
| AI Gateway Read/Edit/Run | Route external model providers through AI Gateway. |

Optional zone permission:

| Permission | Why |
| --- | --- |
| Workers Routes Edit / Write | Attach deployed agents to custom zone routes. |

Cloudflare publishes the current token permission list in its API token permissions reference. If a permission name changes between dashboard and API wording, use the equivalent `Write` permission in API-token form.

The `/deploy` self-service form includes a `Create scoped token` button that preloads Cloudflare Dashboard with the current required permission groups. Users still approve and create the token inside Cloudflare; `open-think` cannot silently mint a user token without Cloudflare OAuth, partner provisioning, or a separate token-creation grant.

For R2, the Cloudflare template key is `workers_r2`, and the Dashboard should show `Account > Workers R2 Storage > Edit`. Tokens created from older links that used `workers_r2_storage` will fail provisioning at the R2 read/create step.
