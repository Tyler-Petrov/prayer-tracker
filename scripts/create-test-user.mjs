// Makes the test user in Clerk's development instance, for agents and automated testing: external id
// `prayer-test`, username `prayer_test`, "Prayer Test", no email and no password. The instance is Google only, so
// the Backend API won't take an email address; the username is what Clerk needs on the account for a sign-in token
// to work ("doesn't have an associated identification" otherwise). It only ever signs in through
// scripts/sign-in.mjs links. Safe to re-run: an existing test user is kept (and given the username if it lacks
// it). Refuses anything but a development (sk_test_) key.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTERNAL_ID = 'prayer-test';
const USERNAME = 'prayer_test';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '../.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) fail('CLERK_SECRET_KEY is missing from .env.local');
if (!secretKey.startsWith('sk_test_')) fail('CLERK_SECRET_KEY is not a development (sk_test_) key');

const [existing] = await clerk('GET', `/users?external_id=${EXTERNAL_ID}`);
if (existing) {
	if (!existing.username) await clerk('PATCH', `/users/${existing.id}`, { username: USERNAME });
	console.log(`The test user is already there: ${existing.id} (external id ${EXTERNAL_ID})`);
} else {
	const user = await clerk('POST', '/users', {
		external_id: EXTERNAL_ID,
		username: USERNAME,
		first_name: 'Prayer',
		last_name: 'Test',
		skip_password_requirement: true
	});
	console.log(`Made the test user: ${user.id} (external id ${EXTERNAL_ID})`);
}

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
