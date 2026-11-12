import { defineApp } from 'convex/server';
import { v } from 'convex/values';

// CLERK_FRONTEND_API_URL is the Clerk instance that signs people in (auth.config.ts). Set it on each deployment.
const app = defineApp({
	env: {
		CLERK_FRONTEND_API_URL: v.string()
	}
});

export default app;
