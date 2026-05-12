import { expect, test } from '@playwright/test';
import { loginAsAdmin, runPageUrl } from '../helpers/wp-admin.js';
import { statusText, urlInput, waitForSandboxReady } from '../helpers/sandbox.js';

test.describe('Direct Run', () => {
	test('boots the sandbox when navigating straight to the Run page', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto(runPageUrl());

		await waitForSandboxReady(page);

		await expect(statusText(page)).toHaveText('Ready');
		await expect(urlInput(page)).toBeEnabled();
		await expect(page.locator('#lse-preview-iframe')).toBeVisible();

		// Editor toggle should be reachable once the sandbox is ready.
		const editorToggle = page.locator('[data-wp-on--click="actions.toggleEditor"]');
		await expect(editorToggle).toBeEnabled();
	});
});
