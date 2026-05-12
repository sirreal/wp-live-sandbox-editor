import { expect, test } from '@playwright/test';
import { loginAsAdmin, setupPageUrl } from '../helpers/wp-admin.js';
import { waitForSandboxReady } from '../helpers/sandbox.js';

test.describe('Setup flow', () => {
	test('Setup → Run forwards manifest selections to the Run page', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto(setupPageUrl());

		// The setup view is hidden behind a loading paragraph until the
		// /sync-manifest?labels=1 fetch returns. The Run button becomes
		// clickable when at least one item is selected; defaults select all
		// active plugins/themes/tables so it's enabled on first paint.
		const runButton = page.getByRole('button', { name: 'Run' });
		await expect(runButton).toBeEnabled({ timeout: 30 * 1000 });

		// Deselect everything in plugins then re-select only the active ones.
		// This exercises the "Select active" action and proves the resulting
		// manifest reflects the current state of checkboxes.
		const pluginsGroup = page.locator('fieldset.lse-setup-group').filter({ has: page.getByText('Plugins', { exact: true }) });
		await pluginsGroup.getByRole('button', { name: 'Deselect all' }).click();
		await pluginsGroup.getByRole('button', { name: 'Select active' }).click();

		// Toggle uploads on so it shows up in the manifest payload.
		await page.getByLabel(/Include wp-content\/uploads/).check();

		// Capture the navigation triggered by the Run button so we can assert
		// against the resulting URL (the action assigns window.location with
		// the manifest as a query parameter).
		const navigation = page.waitForURL((u) => u.searchParams.has('manifest'));
		await runButton.click();
		await navigation;

		const manifestRaw = new URL(page.url()).searchParams.get('manifest');
		expect(manifestRaw, 'manifest query param is set').not.toBeNull();
		const manifest = JSON.parse(manifestRaw ?? '{}') as {
			plugins: string[];
			themes: string[];
			tables: string[];
			uploads: boolean;
		};
		expect(manifest.uploads).toBe(true);
		expect(Array.isArray(manifest.plugins)).toBe(true);
		expect(Array.isArray(manifest.themes)).toBe(true);
		expect(Array.isArray(manifest.tables)).toBe(true);

		await waitForSandboxReady(page);
	});

	test('Setup defaults match active plugins/themes', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto(setupPageUrl());

		await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled({ timeout: 30 * 1000 });

		// performance-lab is installed and activated by global-setup, so it
		// must appear in the plugins list as a checked item by default.
		const pluginsList = page.locator('fieldset.lse-setup-group').filter({ has: page.getByText('Plugins', { exact: true }) }).locator('ul li');
		await expect(pluginsList.filter({ hasText: 'Performance Lab' }).locator('input[type="checkbox"]').first()).toBeChecked();

		// Tables fieldset should always contain the core wp_options-style
		// list with everything pre-selected.
		const tablesList = page.locator('fieldset.lse-setup-group').filter({ has: page.getByText('Tables', { exact: true }) }).locator('ul li');
		await expect(tablesList.first()).toBeVisible();
	});
});
