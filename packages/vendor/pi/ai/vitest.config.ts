import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const telemetrySrcIndex = fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url));
const schemaSrcIndex = fileURLToPath(new URL("../schema/src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000, // 30 seconds for API calls
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		silent: "passed-only",
		// NOTE (absorption): these suites are credential-gated E2E tests (GitHub Copilot OAuth,
		// live provider probes). pi's own CI runs them with real tokens; locally they are excluded.
		exclude: [
			"test/anthropic-eager-tool-input-e2e.test.ts",
			"test/anthropic-long-cache-retention-e2e.test.ts",
			"test/context-overflow.test.ts",
			"test/image-tool-result.test.ts",
			"test/openai-responses-tool-result-images.test.ts",
			"test/responseid.test.ts",
			"test/stream.test.ts",
			"test/tokens.test.ts",
			"test/tool-call-without-result.test.ts",
			"test/total-tokens.test.ts",
			"test/unicode-surrogate.test.ts",
		],
	},
	resolve: {
		alias: [
			{ find: /^@earendil-works\/pi-telemetry$/, replacement: telemetrySrcIndex },
			// NOTE (absorption): pi resolves pi-schema via the "source" export condition; under this
			// workspace's vitest the source-condition-only lookup fails, so we alias it like the rest.
			{ find: /^@earendil-works\/pi-schema$/, replacement: schemaSrcIndex },
		],
		// Workspace packages without a build (pi-schema) resolve to their source.
		conditions: ["source"],
	},
	ssr: { resolve: { conditions: ["source"] } },
});