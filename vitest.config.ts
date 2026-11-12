import { defineConfig } from 'vitest/config';

// Apart from vite.config.ts so tests don't start SvelteKit. Two projects: the shared modules in Node (where the
// tests can change the timezone and take Temporal away), and the Convex functions in the edge runtime convex-test
// expects, close to Convex's own.
export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'shared',
					environment: 'node',
					include: ['convex/shared/**/*.test.ts', 'src/**/*.test.ts']
				}
			},
			{
				test: {
					name: 'convex',
					environment: 'edge-runtime',
					include: ['convex/**/*.test.ts'],
					exclude: ['convex/shared/**'],
					server: { deps: { inline: ['convex-test'] } }
				}
			}
		]
	}
});
