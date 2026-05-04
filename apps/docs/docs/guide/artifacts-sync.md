# Artifacts Sync

After the first bootstrap, `open-think` can treat a Cloudflare Artifacts Git remote as the canonical repository.

The sync loop is:

1. Worker or agent edits files in a draft repository.
2. `repo.commit` commits the draft to the Artifacts Git remote.
3. `repo.push` pushes the commit.
4. `repo.deploy` uploads `worker.js` to the configured Cloudflare Worker script.
5. Local developers pull the same Artifacts remote when they want a local checkout.

## Environment

```bash
ARTIFACTS_REMOTE=https://<account-id>.artifacts.cloudflare.net/git/<namespace>/<repo>.git
ARTIFACTS_TOKEN=<token>
ARTIFACTS_BRANCH=main
OPEN_THINK_AUTO_SYNC=true
OPEN_THINK_SYNC_DIRECTION=bidirectional
OPEN_THINK_AUTO_SYNC_INTERVAL_SECONDS=300
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<workers-scripts-write-token>
OPEN_THINK_SCRIPT_NAME=open-think-platform
```

## Local Clone

Use the Artifacts Git remote as a normal authenticated Git remote:

```bash
git -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" \
  clone "$ARTIFACTS_REMOTE" open-think-artifact
```

Manual local pull:

```bash
git -C open-think-artifact \
  -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" \
  pull origin main
```

Manual local push:

```bash
git -C open-think-artifact \
  -c http.extraHeader="Authorization: Bearer $ARTIFACTS_TOKEN" \
  push origin main
```

## Automatic Sync

The Worker has a five-minute cron trigger. When `OPEN_THINK_AUTO_SYNC=true`, the scheduled handler runs the same reconciler as the `/sync` UI.

Supported directions:

- `pull-from-remote`: pull remote Artifacts commits into the Worker draft.
- `push-to-remote`: commit/push Worker draft changes and mark them deployable.
- `bidirectional`: pull remote changes first, then commit/push/deploy local draft changes when present.

Use `pull-from-remote` for teams that primarily edit locally. Use `bidirectional` when both local developers and agents are expected to edit.

Deploy refuses to mark a revision as live unless the Cloudflare account id, API token, script name, and built `worker.js` are present.
