import { defineConfig, devices } from '@playwright/test';
import { ensureWpEnvRunning } from './tests/e2e/helpers/wp-env.js';

// Resolved at config-load time. `ensureWpEnvRunning` is sync (it spawns
// wp-env or pings the cached port via a child process) so the baseURL
// below can use it directly. On warm runs this is a single sub-process
// ping to the cached port — no wp-env restart.
const session = ensureWpEnvRunning();
const BASE_URL = process.env['WP_BASE_URL'] ?? session.baseUrl;

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
	// boots its own Playground remote session, and the only host-side
	// write (fixtures) happens in the wp-env setup project before any
	// chromium spec runs. Resource pressure on PHP-FPM / bandwidth /
	// remote Playground may surface as flake under high parallelism —
	// drop `workers` if that lands.
	fullyParallel: true,
	// CI gets one retry to absorb network-induced flake from
	// playground.wordpress.net cold boots; local runs stay at 0 so a
	// real failure surfaces on the first attempt instead of being
	// silently retried.
	retries: IS_CI ? 1 : 0,
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
			// The "wp-env" project only primes test fixtures now. Actually
			// booting wp-env happens at config-load time via
			// `ensureWpEnvRunning()` so the URL is available before any
			// project runs.
			name: 'wp-env',
			testDir: './tests/e2e',
			testMatch: /wp-env\.setup\.ts/,
			timeout: 10 * 60 * 1000,
		},
		{
			// Logs into wp-admin once and writes the cookie/localStorage
			// state to `tests/.cache/admin-storage.json`. The chromium
			// project below loads that file via `use.storageState` so each
			// spec opens already-authenticated — no per-test wp-login.php
			// round trip.
			name: 'auth',
			testDir: './tests/e2e',
			testMatch: /auth\.setup\.ts/,
			dependencies: ['wp-env'],
		},
		{
			name: 'chromium',
			dependencies: ['auth'],
			use: {
				...devices['Desktop Chrome'],
				storageState: 'tests/.cache/admin-storage.json',
			},
		},
	],
});
