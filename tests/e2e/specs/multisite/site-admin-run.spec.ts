import { expect, test } from '@playwright/test';
import { runPageUrl, SITE_ADMIN_STORAGE_STATE } from '../../helpers/wp-admin.js';
import { statusText, urlInput, waitForSandboxReady } from '../../helpers/sandbox.js';

// Subsite admin path: the regression-coverage case for the
// inc/manifest.php auth fix. A user with `administrator` on /site2 but
// no Super Admin grant must still be able to boot LSE on their subsite.
// Pre-fix, the default manifest leaked global tables (wp_users etc.)
// to this user; post-fix, the manifest is filtered to /site2's blog
// tables and the sandbox boots cleanly.
test.use({ storageState: SITE_ADMIN_STORAGE_STATE });

test('subsite admin boots LSE on /site2', async ({ page }) => {
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
