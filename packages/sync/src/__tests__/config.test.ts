import { describe, expect, it } from "vitest";
import { syncConfigFromEnv } from "../config";

describe("syncConfigFromEnv", () => {
  it("preserves Worker upload metadata keep_bindings for deployment updates", () => {
    const config = syncConfigFromEnv({
      ARTIFACTS_REMOTE: "https://artifacts.example/open-think.git",
      ARTIFACTS_TOKEN: "token",
      OPEN_THINK_WORKER_UPLOAD_METADATA: JSON.stringify({
        main_module: "worker.js",
        compatibility_date: "2026-05-01",
        compatibility_flags: ["nodejs_compat"],
        bindings: [],
        keep_bindings: ["secret_text", "secret_key"]
      })
    });

    expect(config.workerUploadMetadata?.keep_bindings).toEqual([
      "secret_text",
      "secret_key"
    ]);
  });
});
