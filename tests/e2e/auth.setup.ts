/**
 * Playwright "setup project" that logs into wp-admin once and persists
 * the resulting browser state (cookies + localStorage) to disk. The
 * chromium project consumes that file via `use.storageState`, so every
 * spec opens already-authenticated — no per-test `loginAsAdmin` round
 * trip. The wp-env setup project runs first (dependency chain in
 * playwright.config.ts) so wp-login.php is reachable by the time we
 * fill the form.
 */
import { test as setup } from '@playwright/test';
import { loginAsAdmin, ADMIN_STORAGE_STATE } from './helpers/wp-admin.js';

setup('authenticate as admin', async ({ page }) => {
	console.log('[auth] Logging in as admin (single-site)...');
	await loginAsAdmin(page);
	await page.context().storageState({ path: ADMIN_STORAGE_STATE });
	console.log(`[auth] Saved storage state to ${ADMIN_STORAGE_STATE}`);
});
