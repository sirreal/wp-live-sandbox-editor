/**
 * Playwright "setup project" that runs once before the chromium spec
 * project (wired through `dependencies: ['wp-env']` in
 * playwright.config.ts).
 *
 * Booting wp-env itself happens at config-load time in
 * playwright.config.ts via `ensureWpEnvRunning()` — by the time these
 * tests execute the dev site is reachable. The remaining job is to
 * prime the WordPress install with the fixtures the specs depend on:
 * deliberately outdated copies of performance-lab and
 * twentytwentyeleven so the .org update API reports a new version and
 * the per-row "test the update in the sandbox" links render.
 */
import { test as setup } from '@playwright/test';
import { wpCli } from './helpers/wp-cli.js';

const PERFORMANCE_LAB_OLD_VERSION = '3.0.0';
const TWENTY_ELEVEN_OLD_VERSION = '4.0';

setup('test fixtures installed', async () => {
	// Install older versions on purpose: an update must be available for
	// the host-side "test the plugin/theme update in the sandbox" link
	// to render, which is what the plugin- and theme-update specs click
	// on. `--force` lets the install overwrite a newer copy left over
	// from a previous run so the suite is rerunnable without a fresh
	// wp-env.
	console.log(`[single-site-setup] Installing performance-lab ${PERFORMANCE_LAB_OLD_VERSION} (force, activate)...`);
	wpCli(['plugin', 'install', 'performance-lab', `--version=${PERFORMANCE_LAB_OLD_VERSION}`, '--force', '--activate']);

	console.log(`[single-site-setup] Installing twentyeleven ${TWENTY_ELEVEN_OLD_VERSION} (force)...`);
	wpCli(['theme', 'install', 'twentyeleven', `--version=${TWENTY_ELEVEN_OLD_VERSION}`, '--force']);

	// Wipe the cached update-check transients so the next API call
	// doesn't short-circuit on a stale "no updates" result from a
	// previous run. `ignoreErrors` covers the first-run case where the
	// transient hasn't been written yet.
	console.log('[single-site-setup] Invalidating update-check transients and forcing a refresh...');
	wpCli(['transient', 'delete', 'update_plugins'], { ignoreErrors: true });
	wpCli(['transient', 'delete', 'update_themes'], { ignoreErrors: true });

	// Force WP to query the .org update API now so plugins.php /
	// themes.php render the "new version available" rows the
	// upgrade-link tests need. Without this, the first page render
	// happens before the cron-scheduled check runs and the rows are
	// missing.
	wpCli(['eval', 'wp_update_plugins(); wp_update_themes();']);

	console.log('[single-site-setup] Fixtures ready.');
});
