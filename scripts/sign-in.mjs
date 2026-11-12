// Prints a five-minute sign-in link for the local dev site, so an agent (or you) can sign in without Google.
// Usage: node scripts/sign-in.mjs [who] [success path]
// `who` is an email (someone who has signed in with Google) or a Clerk external id. It defaults to the test user,
// external id `prayer-test`, which scripts/create-test-user.mjs makes: the Clerk instance is Google only, so it
// won't take an email address on a user made through the Backend API; the test user has a username instead
// (a sign-in token needs some identification on the account). The link opens
// /sign-in-token/<token>, which signs in with Clerk and goes on to the success path. Set SIGN_IN_ORIGIN when the
// dev server isn't on http://localhost:5191. From Meal Tracker (and Jairus's scripts/sign-in-as-system.ts).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [who = 'prayer-test', successPath = '/'] = process.argv.slice(2);
const origin = process.env.SIGN_IN_ORIGIN ?? 'http://localhost:5191';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '../.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) fail('CLERK_SECRET_KEY is missing from .env.local');
// Only Clerk's development instance: a link into production would sign in as a real person.
if (!secretKey.startsWith('sk_test_')) fail('CLERK_SECRET_KEY is not a development (sk_test_) key');
if (!successPath.startsWith('/') || successPath.startsWith('//'))
	fail('The success path must start with /');

const lookup = who.includes('@') ? 'email_address' : 'external_id';
const [user] = await clerk('GET', `/users?${lookup}=${encodeURIComponent(who)}`);
if (!user)
	fail(
		who === 'prayer-test'
			? 'No test user yet: run `node scripts/create-test-user.mjs` first'
			: `No one in Clerk's development instance has the ${lookup.replace('_', ' ')} ${who}`
	);
const { token } = await clerk('POST', '/sign_in_tokens', {
	user_id: user.id,
	expires_in_seconds: 5 * 60
});

const url = new URL(`/sign-in-token/${token}`, origin);
url.searchParams.set('url', successPath);
console.log(`Sign-in link for ${who} (expires in 5 minutes):\n${url}`);

/** Clerk's Backend API, with the dev instance's secret key. */
async function clerk(method, path, body) {
	const response = await fetch(`https://api.clerk.com/v1${path}`, {
		method,
		headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
		body: body && JSON.stringify(body)
	});
	const result = await response.json();
	if (!response.ok)
		fail(`Clerk ${method} ${path} failed: ${JSON.stringify(result.errors ?? result)}`);
	return result;
}

/** @param {string} message */
function fail(message) {
	console.error(message);
	process.exit(1);
}
