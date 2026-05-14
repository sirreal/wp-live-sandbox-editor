import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const USERNAME = process.env['WP_ADMIN_USER'] ?? 'admin';
const PASSWORD = process.env['WP_ADMIN_PASSWORD'] ?? 'password';

// Storage state captured once by the `auth` setup project and reused
// via `use.storageState` in playwright.config.ts. Lives under the
// gitignored tests/.cache/ tree alongside the wp-env port cache.
export const ADMIN_STORAGE_STATE = 'tests/.cache/admin-storage.json';

// Multisite storage states populated by the `auth-multisite` setup
// project. Specs opt in via `test.use({ storageState })` so the same
// chromium-multisite project can host both identities.
export const SUPER_ADMIN_STORAGE_STATE = 'tests/.cache/super-admin-storage.json';
export const SITE_ADMIN_STORAGE_STATE = 'tests/.cache/site-admin-storage.json';

/**
 * Log into wp-admin as an arbitrary user. Idempotent on the happy path:
 * if the page already redirected to `/wp-admin/` (live session cookie)
 * the function returns without re-submitting. Admin "welcome" pointers
 * that would otherwise overlay row actions are suppressed server-side
 * by the lse-tests-no-pointers mu-plugin (mapped via each
 * .wp-env.json).
 */
export async function loginAs(page: Page, username: string, password: string): Promise<void> {
	await page.goto('/wp-login.php');
	if (page.url().includes('/wp-admin/')) {
		return;
	}
	await page.locator('input[name="log"]').fill(username);
	await page.locator('input[name="pwd"]').fill(password);
	await Promise.all([page.waitForURL(/\/wp-admin\//), page.locator('input[name="wp-submit"]').click()]);
	await expect(page.locator('body')).toContainText('Dashboard');
}

/**
 * Log in as the default wp-env admin (admin/password). Thin wrapper
 * around `loginAs` for callers that don't need a credential override.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
	await loginAs(page, USERNAME, PASSWORD);
}

/**
 * URL of the LSE Setup page. On multisite, pass the subsite path
 * (e.g. `'/site2'`) as `sitePath` to land on that subsite's admin.
 * Default empty string preserves the single-site call sites.
 */
export function setupPageUrl(sitePath = ''): string {
	return `${sitePath}/wp-admin/admin.php?page=live-sandbox-editor-setup`;
}

/**
 * URL of the LSE Run page. `sitePath` selects the subsite admin on
 * multisite (`'/site2'` → `/site2/wp-admin/...`); `manifestParam` is
 * forwarded as the `manifest` query string when provided.
 */
export function runPageUrl(sitePath = '', manifestParam?: string): string {
	const base = `${sitePath}/wp-admin/admin.php?page=live-sandbox-editor`;
	return manifestParam ? `${base}&manifest=${encodeURIComponent(manifestParam)}` : base;
}
