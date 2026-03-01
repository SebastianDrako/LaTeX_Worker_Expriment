import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Inject test values for secrets (real values live in wrangler secret put)
          bindings: {
            CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            CF_ACCESS_AUD: "test-audience-12345",
          },
        },
      },
    },
  },
});
