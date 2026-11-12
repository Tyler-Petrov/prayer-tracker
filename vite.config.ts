import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
	// 5173 is Meal Tracker's. Extra hosts the dev server answers to (a Tailscale name, say) come from
	// DEV_ALLOWED_HOSTS in .env.local, comma-separated, so they stay out of this public repo.
	server: {
		port: 5191,
		strictPort: true,
		allowedHosts: (loadEnv(mode, process.cwd(), '').DEV_ALLOWED_HOSTS ?? '')
			.split(',')
			.map((host) => host.trim())
			.filter(Boolean)
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},
			adapter: adapter(),
			experimental: { remoteFunctions: true }
		})
	]
}));
