import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const USERNAME = process.env['WP_ADMIN_USER'] ?? 'admin';
const PASSWORD = process.env['WP_ADMIN_PASSWORD'] ?? 'password';

/**
 * Log into wp-admin. wp-env's default credentials are admin/password.
 * Idempotent: returns immediately if a logged-in cookie is already
 * present. Admin "welcome" pointers that would otherwise overlay
 * plugins.php / themes.php row actions are suppressed server-side by
 * the lse-tests-no-pointers mu-plugin (mapped via tests/.wp-env.json).
 */
export async function loginAsAdmin(page: Page): Promise<void> {
	await page.goto('/wp-login.php');
	if (page.url().includes('/wp-admin/')) {
		return;
	}
	await page.locator('input[name="log"]').fill(USERNAME);
	await page.locator('input[name="pwd"]').fill(PASSWORD);
	await Promise.all([page.waitForURL(/\/wp-admin\//), page.locator('input[name="wp-submit"]').click()]);
	await expect(page.locator('body')).toContainText('Dashboard');
}

export function setupPageUrl(): string {
	return '/wp-admin/admin.php?page=live-sandbox-editor-setup';
}

export function runPageUrl(manifestParam?: string): string {
	const base = '/wp-admin/admin.php?page=live-sandbox-editor';
	return manifestParam ? `${base}&manifest=${encodeURIComponent(manifestParam)}` : base;
}
