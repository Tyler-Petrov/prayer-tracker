import { cancel, confirm, isCancel } from '@clack/prompts';
import { spawnSync } from 'node:child_process';

function checkReleaseNeeded() {
	const latestProductionRun = spawnSync(
		'gh',
		[
			'run',
			'list',
			'--workflow',
			'deploy-production.yml',
			'--limit',
			'1',
			'--json',
			'headSha,conclusion,status'
		],
		{ encoding: 'utf8' }
	);

	if (latestProductionRun.status !== 0) {
		process.stderr.write(latestProductionRun.stderr ?? '');
		process.stderr.write(latestProductionRun.error?.message ?? '');
		console.error('Could not determine the latest production release.');
		process.exitCode = 1;
		return false;
	}

	const [productionRun] = JSON.parse(latestProductionRun.stdout);

	if (productionRun && productionRun.status !== 'completed') {
		console.error(
			'A production release is already active. Wait for it to finish before releasing again.'
		);
		process.exitCode = 1;
		return false;
	}

	const mainRevision = spawnSync(
		'gh',
		['api', 'repos/{owner}/{repo}/commits/main', '--jq', '.sha'],
		{ encoding: 'utf8' }
	);
	const mainSha = mainRevision.stdout?.trim();

	if (mainRevision.status !== 0 || !mainSha) {
		process.stderr.write(mainRevision.stderr ?? '');
		process.stderr.write(mainRevision.error?.message ?? '');
		console.error('Could not determine the main revision to release.');
		process.exitCode = 1;
		return false;
	}

	if (productionRun?.conclusion === 'success' && productionRun.headSha === mainSha) {
		console.log('Nothing to release: main is already released to production.');
		return false;
	}

	return true;
}

async function releaseProduction() {
	const ghVersion = spawnSync('gh', ['--version'], { encoding: 'utf8' });
	const ghVersionMatch = ghVersion.stdout?.match(/^gh version (\d+)\.(\d+)\.(\d+)/);
	const ghMajorVersion = Number(ghVersionMatch?.[1]);
	const ghMinorVersion = Number(ghVersionMatch?.[2]);
	const ghReturnsRunUrl = ghMajorVersion > 2 || (ghMajorVersion === 2 && ghMinorVersion >= 87);

	if (ghVersion.status !== 0 || !ghVersionMatch || !ghReturnsRunUrl) {
		process.stderr.write(ghVersion.stderr ?? '');
		process.stderr.write(ghVersion.error?.message ?? '');
		console.error(
			'Release requires GitHub CLI 2.87.0 or newer so the dispatched workflow can be watched.'
		);
		process.exitCode = 1;
		return;
	}

	if (!checkReleaseNeeded()) return;

	const latestCompletedRun = spawnSync(
		'gh',
		[
			'run',
			'list',
			'--status',
			'completed',
			'--limit',
			'1',
			'--json',
			'databaseId',
			'--jq',
			'.[0].databaseId // empty'
		],
		{ encoding: 'utf8' }
	);
	const latestCompletedRunId = latestCompletedRun.stdout?.trim();

	if (latestCompletedRun.status !== 0) {
		process.stderr.write(latestCompletedRun.stderr ?? '');
		process.stderr.write(latestCompletedRun.error?.message ?? '');
		console.error('Release requires read access to GitHub Actions runs.');
		process.exitCode = 1;
		return;
	}

	// With no completed run yet (the first release), there is nothing to probe.
	const watchAccess = latestCompletedRunId
		? spawnSync('gh', ['run', 'watch', latestCompletedRunId], {
				encoding: 'utf8'
			})
		: { status: 0 };

	if (watchAccess.status !== 0) {
		process.stderr.write(watchAccess.stderr ?? '');
		process.stderr.write(watchAccess.error?.message ?? '');
		console.error(
			'Release requires GitHub Actions checks read access so the deployment can be watched.'
		);
		process.exitCode = 1;
		return;
	}

	const confirmed = await confirm({
		message:
			'Deploy production? This dispatches the Deploy production workflow on main: ' +
			'the web app is staged on Cloudflare, Convex deploys, then the staged version is promoted.',
		initialValue: false
	});

	if (isCancel(confirmed) || !confirmed) {
		cancel('Release aborted.');
		process.exitCode = 1;
		return;
	}

	if (!checkReleaseNeeded()) return;

	const dispatch = spawnSync(
		'gh',
		['workflow', 'run', 'deploy-production.yml', '--ref', 'main', '-f', 'confirm_production=true'],
		{ encoding: 'utf8' }
	);

	if (dispatch.status !== 0) {
		process.stderr.write(dispatch.stderr ?? '');
		process.stderr.write(dispatch.error?.message ?? '');
		process.exitCode = dispatch.status ?? 1;
		return;
	}

	// gh prints the created run's URL when it can resolve it.
	const runUrl = dispatch.stdout?.match(/https:\/\/\S+\/actions\/runs\/\d+\S*/)?.[0]?.trim();
	const runId = runUrl?.match(/\/actions\/runs\/(\d+)/)?.[1];

	if (!runId) {
		console.error(
			'Deploy dispatched, but GitHub CLI did not return its run URL, so its status cannot be watched.'
		);
		process.exitCode = 1;
		return;
	}

	console.log(`Deploy dispatched: ${runUrl}`);

	const watch = spawnSync('gh', ['run', 'watch', runId, '--exit-status'], {
		stdio: 'inherit'
	});

	if (watch.error) {
		console.error(watch.error.message);
		process.exitCode = 1;
		return;
	}

	process.exitCode = watch.status ?? 1;
}

await releaseProduction();
