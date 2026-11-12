import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_CONVEX_URL: {
		public: true,
		static: true,
		description: 'Convex deployment URL, written to .env.local by `convex dev`'
	},
	PUBLIC_CLERK_PUBLISHABLE_KEY: {
		public: true,
		static: true,
		description: 'Clerk publishable key (pk_test_ in .env.local): signs people in with Google'
	},
	CLERK_SECRET_KEY: {
		public: false,
		static: false,
		description:
			"Clerk secret key (sk_test_ in .env.local, a Worker secret in production): finishes Clerk's sign-in handshake on the server (hooks.server.ts)"
	}
});
