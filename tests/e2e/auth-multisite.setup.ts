/**
 * Playwright "setup project" that logs into the multisite wp-env twice
 * — once as the Super Admin (default `admin`/`password`) and once as
 * the subsite-only administrator (`siteadmin`/`siteadmin`) created by
 * `multisite.setup.ts` — and persists the resulting browser state to
 * two separate files. The multisite specs opt in via per-spec
 * `test.use({ storageState })` so a single `chromium-multisite`
 * project can host both identities.
 *
 * Each test creates its own browser context so cookies don't leak from
 * one identity to the other. `loginAs` is the existing helper, used
 * here with explicit credentials.
 */
import { test as setup } from '@playwright/test';
import { loginAs, SITE_ADMIN_STORAGE_STATE, SUPER_ADMIN_STORAGE_STATE } from './helpers/wp-admin.js';

setup('authenticate as super admin', async ({ browser }) => {
	console.log('[auth-multisite] Logging in as admin (Super Admin)...');
	const ctx = await browser.newContext();
	try {
		const page = await ctx.newPage();
		await loginAs(page, 'admin', 'password');
		await ctx.storageState({ path: SUPER_ADMIN_STORAGE_STATE });
		console.log(`[auth-multisite] Saved storage state to ${SUPER_ADMIN_STORAGE_STATE}`);
	} finally {
		await ctx.close();
	}
});

setup('authenticate as subsite admin', async ({ browser }) => {
	console.log('[auth-multisite] Logging in as siteadmin (subsite admin on /site2)...');
	const ctx = await browser.newContext();
	try {
		const page = await ctx.newPage();
		await loginAs(page, 'siteadmin', 'siteadmin');
		await ctx.storageState({ path: SITE_ADMIN_STORAGE_STATE });
		console.log(`[auth-multisite] Saved storage state to ${SITE_ADMIN_STORAGE_STATE}`);
	} finally {
		await ctx.close();
	}
});
