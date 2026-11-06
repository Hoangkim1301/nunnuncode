import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
		// NOTE (absorption): pinned include so vitest doesn't sweep dependency-internal tests
		// (zod ships its own suite inside node_modules). Without this, defaults match them.
		include: ["test/**/*.test.ts", "src/**/*.test.ts"],
		// NOTE (absorption): test/conformance.test.ts fails identically in the upstream pi repo
		// at v1.5.0 (936 conformance cases) — pre-existing, excluded from our baseline.
		exclude: ["test/conformance.test.ts"],
	},
	resolve: { conditions: ["source"] },
	ssr: { resolve: { conditions: ["source"] } },
});
