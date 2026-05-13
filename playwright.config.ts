import { defineConfig, devices } from '@playwright/test';
import {
	MULTISITE_TESTS_CWD,
	TESTS_CWD,
	ensureMultisiteRunning,
	ensureWpEnvRunning,
	readCachedBaseUrl,
} from './tests/e2e/helpers/wp-env.js';

// Single source of truth for Playwright project names. Used both in
// the `projects:` block below and in the `--project` argv detection
// that decides which wp-env(s) to boot at config-load time.
const PROJECT = {
	wpEnv: 'wp-env',
	auth: 'auth',
	chromium: 'chromium',
	multisiteSetup: 'multisite-setup',
	authMultisite: 'auth-multisite',
	chromiumMultisite: 'chromium-multisite',
} as const;
const SINGLE_SITE_PROJECT_NAMES: ReadonlySet<string> = new Set([
	PROJECT.wpEnv,
	PROJECT.auth,
	PROJECT.chromium,
]);
const MULTISITE_PROJECT_NAMES: ReadonlySet<string> = new Set([
	PROJECT.multisiteSetup,
	PROJECT.authMultisite,
	PROJECT.chromiumMultisite,
]);

/**
 * Parse `--project` / `-p` filters out of process.argv. Playwright
 * accepts both `--project=name` and `--project name`. When no filter
 * is present, the returned set is empty and the caller treats that as
 * "all projects".
 */
function parseRequestedProjects(argv: readonly string[]): ReadonlySet<string> {
	const out = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === undefined) continue;
		if (arg === '--project' || arg === '-p') {
			const next = argv[i + 1];
			if (next !== undefined) out.add(next);
		} else if (arg.startsWith('--project=')) {
			out.add(arg.slice('--project='.length));
		} else if (arg.startsWith('-p=')) {
			out.add(arg.slice('-p='.length));
		}
	}
	return out;
}

// Playwright spawns worker subprocesses (and a UI server subprocess in
// --ui mode) that re-load this config file. Those subprocesses are
// invoked as `node .../playwright/lib/common/process.js ...` — the
// parent's `--project` flag does NOT propagate through their argv, so
// argv-based filtering would mis-detect "no filter" and try to boot
// every wp-env. The detection below identifies a child process and
// skips booting entirely; the parent process is the single
// authoritative wp-env owner, and children just read the cached
// baseURL the parent wrote.
const isPlaywrightChildProcess = /[\\/]playwright[\\/]lib[\\/]common[\\/]process\.js$/.test(
	process.argv[1] ?? '',
);

const requestedProjects = parseRequestedProjects(process.argv);
const projectFilterActive = requestedProjects.size > 0;
const wantsSet = (set: ReadonlySet<string>): boolean =>
	!projectFilterActive || [...requestedProjects].some((p) => set.has(p));

const needSingleSite = !isPlaywrightChildProcess && wantsSet(SINGLE_SITE_PROJECT_NAMES);
const needMultisite = !isPlaywrightChildProcess && wantsSet(MULTISITE_PROJECT_NAMES);

// Both boot helpers are sync (they spawn wp-env or ping the cached
// port via a child process), so the baseURLs below can use them
// directly. On warm runs each call is a single sub-process ping to
// its cached port — no wp-env restart.
//
// Two wp-env sessions can run side-by-side on distinct auto-discovered
// ports: `tests/.wp-env.json` (single-site) and
// `tests-multisite/.wp-env.json` (`"multisite": true`). Their caches
// and locks live under their own .cache/ dirs so the sessions don't
// contend. To keep `--project` invocations lean (e.g. `test:pw:multi`
// shouldn't boot the single-site env), each session is only booted
// when the current process is the main Playwright CLI AND at least
// one requested project — or the unfiltered "all projects" case —
// actually needs it.
const session = needSingleSite ? ensureWpEnvRunning() : null;
const multisiteSession = needMultisite ? ensureMultisiteRunning() : null;
const BASE_URL =
	process.env['WP_BASE_URL'] ?? session?.baseUrl ?? readCachedBaseUrl(TESTS_CWD);
const MULTISITE_BASE_URL =
	process.env['WP_BASE_URL_MULTISITE'] ??
	multisiteSession?.baseUrl ??
	readCachedBaseUrl(MULTISITE_TESTS_CWD);

// `CI=true` is set by every mainstream CI runner — GitHub Actions,
// GitLab CI, CircleCI, etc. — and is the customary gate for
// "behave-like-CI" branches in npm tooling. The strict-equality check
// avoids tripping on stray empty values.
const IS_CI = process.env['CI'] === 'true';

export default defineConfig({
	testDir: './tests/e2e',
	// Playground boots an iframe against playground.wordpress.net — keep these
	// generous; a cold boot can run 60+ seconds before the sandbox is "Ready".
	timeout: 5 * 60 * 1000,
	expect: { timeout: 90 * 1000 },
	// Specs are independent: each test owns its browser context and
	// boots its own Playground remote session. Two pressure points cap
	// the worker count:
	//  - playground.wordpress.net cold-boots are noticeably less
	//    reliable when 8+ iframes ask at once.
	//  - wp-env's `wp-env-cache.json` is a racy read-modify-write per
	//    `wp-env run cli` invocation; under high concurrency one CLI
	//    call's setCache can clobber another's and the env loses its
	//    `runtime` key, which surfaces as "Environment not initialized"
	//    on the next call. Half the typical CPU count keeps that
	//    race quiet without dragging out the wall time noticeably.
	fullyParallel: true,
	workers: 4,
	// One retry buys back the residual flake from the two pressure
	// points above (Playground cold-boot variance, wp-env cache race).
	// Locally and in CI alike — a real consistent failure still surfaces
	// after the retry runs and also fails.
	retries: 1,
	reporter: IS_CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: BASE_URL,
		actionTimeout: 30 * 1000,
		navigationTimeout: 60 * 1000,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			// Primes test fixtures (outdated plugin/theme versions).
			// wp-env itself is booted at config-load time via
			// `ensureWpEnvRunning()`. Regex is anchored so a future
			// `*-wp-env.setup.ts` sibling can't get vacuumed in here.
			name: PROJECT.wpEnv,
			testDir: './tests/e2e',
			testMatch: /[\\/]wp-env\.setup\.ts$/,
			timeout: 10 * 60 * 1000,
		},
		{
			// Logs into wp-admin once and writes the cookie/localStorage
			// state to `tests/.cache/admin-storage.json`. The chromium
			// project below loads that file via `use.storageState` so each
			// spec opens already-authenticated — no per-test wp-login.php
			// round trip.
			name: PROJECT.auth,
			testDir: './tests/e2e',
			testMatch: /[\\/]auth\.setup\.ts$/,
			dependencies: [PROJECT.wpEnv],
		},
		{
			name: PROJECT.chromium,
			dependencies: [PROJECT.auth],
			// Multisite specs live under tests/e2e/specs/multisite/ and
			// run on the second wp-env via the chromium-multisite
			// project. Exclude them here so the single-site chain
			// doesn't try to drive them against the wrong baseURL.
			testIgnore: /[\\/]multisite[\\/]/,
			use: {
				...devices['Desktop Chrome'],
				storageState: 'tests/.cache/admin-storage.json',
			},
		},
		{
			// Provisions site2 + the non-super-admin `siteadmin` user
			// against the multisite wp-env via wp-cli. Idempotent —
			// see tests/e2e/multisite.setup.ts. The path-anchored
			// regex is load-bearing: an un-anchored
			// `/multisite\.setup\.ts/` substring-matches
			// `auth-multisite.setup.ts` and pulls those tests into
			// this project, which has no baseURL and would crash with
			// "Cannot navigate to invalid URL".
			name: PROJECT.multisiteSetup,
			testDir: './tests/e2e',
			testMatch: /[\\/]multisite\.setup\.ts$/,
			timeout: 10 * 60 * 1000,
		},
		{
			// Logs in as `admin` (Super Admin) and `siteadmin`
			// (subsite admin) on the multisite wp-env and writes two
			// storage state files. Specs opt in per-test.use.
			name: PROJECT.authMultisite,
			testDir: './tests/e2e',
			testMatch: /[\\/]auth-multisite\.setup\.ts$/,
			dependencies: [PROJECT.multisiteSetup],
			use: { baseURL: MULTISITE_BASE_URL },
		},
		{
			// Multisite smoke specs. No project-level storageState —
			// each spec declares its identity via test.use() at file top.
			name: PROJECT.chromiumMultisite,
			dependencies: [PROJECT.authMultisite],
			testMatch: /[\\/]multisite[\\/].*\.spec\.ts$/,
			use: {
				...devices['Desktop Chrome'],
				baseURL: MULTISITE_BASE_URL,
			},
		},
	],
});
