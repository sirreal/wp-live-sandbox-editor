import { expect, test } from '@playwright/test';
import { runPageUrl, SUPER_ADMIN_STORAGE_STATE } from '../../helpers/wp-admin.js';
import { statusText, urlInput, waitForSandboxReady } from '../../helpers/sandbox.js';

// Super Admin path: the Run page must boot to Ready on both the main
// site of the multisite network and on the /site2 subsite. After Ready,
// drive the toolbar URL input into the cloned WP and assert the nested
// Users screen renders — the same in-iframe signal the single-site
// toolbar spec uses.
test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

test.describe('Multisite super admin', () => {
	test('boots LSE on the main site', async ({ page }) => {
		await page.goto(runPageUrl());

		await waitForSandboxReady(page);

		await expect(statusText(page)).toHaveText('Ready');
		await expect(urlInput(page)).toBeEnabled();
		await expect(page.locator('#lse-preview-iframe')).toBeVisible();
		await expect(page.locator('[data-wp-on--click="actions.toggleEditor"]')).toBeEnabled();

		const input = urlInput(page);
		await input.fill('/wp-admin/users.php');
		await input.press('Enter');

		const wpFrame = page.frameLocator('#lse-preview-iframe').frameLocator('iframe');
		await expect(wpFrame.locator('h1.wp-heading-inline')).toHaveText('Users');
	});

	test('boots LSE on the /site2 subsite', async ({ page }) => {
		await page.goto(runPageUrl('/site2'));

		await waitForSandboxReady(page);

		await expect(statusText(page)).toHaveText('Ready');
		await expect(urlInput(page)).toBeEnabled();
		await expect(page.locator('#lse-preview-iframe')).toBeVisible();
		await expect(page.locator('[data-wp-on--click="actions.toggleEditor"]')).toBeEnabled();

		const input = urlInput(page);
		await input.fill('/wp-admin/users.php');
		await input.press('Enter');

		const wpFrame = page.frameLocator('#lse-preview-iframe').frameLocator('iframe');
		await expect(wpFrame.locator('h1.wp-heading-inline')).toHaveText('Users');
	});
});
