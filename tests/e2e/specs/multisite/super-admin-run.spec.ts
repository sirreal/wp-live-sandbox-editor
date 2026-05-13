import { test } from '@playwright/test';
import { runPageUrl, SUPER_ADMIN_STORAGE_STATE } from '../../helpers/wp-admin.js';
import { assertSandboxBootsAndOpensUsers } from '../../helpers/sandbox.js';

test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

test.describe('Multisite super admin', () => {
	test('boots LSE on the main site', async ({ page }) => {
		await page.goto(runPageUrl());
		await assertSandboxBootsAndOpensUsers(page);
	});

	test('boots LSE on the /site2 subsite', async ({ page }) => {
		await page.goto(runPageUrl('/site2'));
		await assertSandboxBootsAndOpensUsers(page);
	});
});
