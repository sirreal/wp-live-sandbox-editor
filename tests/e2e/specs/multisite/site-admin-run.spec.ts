import { test } from '@playwright/test';
import { runPageUrl, SITE_ADMIN_STORAGE_STATE } from '../../helpers/wp-admin.js';
import { assertSandboxBootsAndOpensUsers } from '../../helpers/sandbox.js';

test.use({ storageState: SITE_ADMIN_STORAGE_STATE });

test('subsite admin boots LSE on /site2', async ({ page }) => {
	await page.goto(runPageUrl('/site2'));
	await assertSandboxBootsAndOpensUsers(page);
});
