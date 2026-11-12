// Clerk's server half, as in Jairus. Coming back from Google, Clerk sends the browser through a "handshake"
// (?__clerk_handshake=…) that only a server can finish: it sets Clerk's cookies and answers with one clean redirect,
// before any of the app's JavaScript loads. Without it, the browser bounced through it mid-load and was left blank.
// The app still renders only in the browser (+layout.ts); this only handles the request.
import { withClerkHandler } from 'svelte-clerk/server';
import { CLERK_SECRET_KEY } from '$app/env/private';
import { PUBLIC_CLERK_PUBLISHABLE_KEY } from '$app/env/public';

export const handle = withClerkHandler({
	secretKey: CLERK_SECRET_KEY,
	publishableKey: PUBLIC_CLERK_PUBLISHABLE_KEY
});
