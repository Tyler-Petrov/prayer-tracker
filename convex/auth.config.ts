import type { AuthConfig } from 'convex/server';
import { env } from './_generated/server';

// Clerk signs people in (Google only), and its "convex" JWT template makes the token Convex checks.
export default {
	providers: [{ domain: env.CLERK_FRONTEND_API_URL, applicationID: 'convex' }]
} satisfies AuthConfig;
