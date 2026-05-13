/**
 * Playwright "setup project" that logs into the multisite wp-env twice
 * — once as the Super Admin (default `admin`/`password`) and once as
 * the subsite-only administrator (`siteadmin`/`siteadmin`) created by
 * `multisite.setup.ts` — and persists the resulting browser state to
 * two separate files. The multisite specs opt in via per-spec
 * `test.use({ storageState })` so a single `chromium-multisite`
 * project can host both identities.
 */
import { test as setup } from '@playwright/test';
import { loginAs, SITE_ADMIN_STORAGE_STATE, SUPER_ADMIN_STORAGE_STATE } from './helpers/wp-admin.js';

// Two distinct identities, fully independent — opt the file into
// parallel mode so they share a wall clock instead of stacking.
setup.describe.configure({ mode: 'parallel' });

setup('authenticate as super admin', async ({ page }) => {
	console.log('[auth-multisite] Logging in as admin (Super Admin)...');
	await loginAs(page, 'admin', 'password');
	await page.context().storageState({ path: SUPER_ADMIN_STORAGE_STATE });
	console.log(`[auth-multisite] Saved storage state to ${SUPER_ADMIN_STORAGE_STATE}`);
});

setup('authenticate as subsite admin', async ({ page }) => {
	console.log('[auth-multisite] Logging in as siteadmin (subsite admin on /site2)...');
	await loginAs(page, 'siteadmin', 'siteadmin');
	await page.context().storageState({ path: SITE_ADMIN_STORAGE_STATE });
	console.log(`[auth-multisite] Saved storage state to ${SITE_ADMIN_STORAGE_STATE}`);
});
