import { type Locator, type Page, expect, test } from '@playwright/test';
import { setupPageUrl } from '../helpers/wp-admin.js';
import { waitForSandboxReady } from '../helpers/sandbox.js';

function groupFieldset(page: Page, legend: 'Plugins' | 'Themes' | 'Tables'): Locator {
	return page.locator('fieldset.lse-setup-group').filter({ has: page.getByText(legend, { exact: true }) });
}

function itemCheckboxes(group: Locator): Locator {
	return group.getByRole('checkbox');
}

// Bulk-action button names share a prefix ("Select all" ⊂ "Select
// active"), so a default substring match would resolve to multiple
// elements and trip Playwright's strict-mode locator check. Always
// require an exact-name match.
function bulkAction(group: Locator, action: 'Select all' | 'Select active' | 'Deselect all'): Locator {
	return group.getByRole('button', { name: action, exact: true });
}

test.describe('Setup flow', () => {
	test('Setup → Run forwards manifest selections to the Run page', async ({ page }) => {
await page.goto(setupPageUrl());

		// The setup view is hidden behind a loading paragraph until the
		// /sync-manifest?labels=1 fetch returns. The Run button becomes
		// clickable when at least one item is selected; defaults select all
		// active plugins/themes/tables so it's enabled on first paint.
		const runButton = page.getByRole('button', { name: 'Run' });
		await expect(runButton).toBeEnabled();

		// Deselect everything in plugins then re-select only the active ones.
		// This exercises the "Select active" action and proves the resulting
		// manifest reflects the current state of checkboxes.
		const plugins = groupFieldset(page, 'Plugins');
		await bulkAction(plugins, 'Deselect all').click();
		await bulkAction(plugins, 'Select active').click();

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

	test('Setup defaults: active plugins/themes checked, all tables checked, uploads off', async ({ page }) => {
await page.goto(setupPageUrl());

		await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();

		// performance-lab is active in the wp-env setup project, so its row
		// is in the plugins list and the checkbox is checked by default —
		// `default_active_plugins()` seeds the manifest.
		const plugins = groupFieldset(page, 'Plugins');
		await expect(plugins.locator('ul li').filter({ hasText: 'Performance Lab' }).getByRole('checkbox')).toBeChecked();

		// Themes: the active stylesheet (and its parent if different) must be
		// the only checked rows. wp-env's default WP install ships with a
		// current Twenty Twenty-X theme active, so at least one theme row is
		// checked and the count is non-zero.
		const themes = groupFieldset(page, 'Themes');
		const themesCheckboxes = itemCheckboxes(themes);
		await expect(themesCheckboxes).not.toHaveCount(0);
		const checkedThemes = themes.locator('ul li input[type="checkbox"]:checked');
		await expect(checkedThemes, 'at least one theme is checked by default').not.toHaveCount(0);

		// Tables: every row in the tables fieldset is pre-selected. The setup
		// store seeds tables with `selected: true` for every row returned by
		// the manifest endpoint, so total === checked.
		const tables = groupFieldset(page, 'Tables');
		const tableCheckboxes = itemCheckboxes(tables);
		await expect(tableCheckboxes, 'tables list is populated').not.toHaveCount(0);
		const checkedTables = tables.locator('ul li input[type="checkbox"]:checked');
		const totalTables = await tableCheckboxes.count();
		await expect(checkedTables, 'every table row is checked by default').toHaveCount(totalTables);

		// Uploads: default manifest carries `uploads: false`, so the toggle
		// renders unchecked.
		await expect(page.getByLabel(/Include wp-content\/uploads/)).not.toBeChecked();
	});

	test('Bulk actions: Select all / Select active / Deselect all, and empty selection disables Run', async ({ page }) => {
await page.goto(setupPageUrl());

		const runButton = page.getByRole('button', { name: 'Run' });
		await expect(runButton).toBeEnabled();

		// Web-first count assertions so we ride out async Interactivity API
		// store updates without re-implementing retry. The `:checked`
		// pseudo-class can't appear under `getByRole`, hence the CSS
		// scoping here. The 'active' branch lives at the caller — it
		// compares two checkbox-state snapshots and needs an array, not a
		// count.
		const assertChecked = async (group: Locator, expected: 'all' | 'none'): Promise<void> => {
			const boxes = itemCheckboxes(group);
			const checked = group.locator('ul li input[type="checkbox"]:checked');
			if (expected === 'all') {
				const total = await boxes.count();
				expect(total, 'group has rows').toBeGreaterThan(0);
				await expect(checked).toHaveCount(total);
			} else {
				await expect(checked).toHaveCount(0);
			}
		};

		for (const legend of ['Plugins', 'Themes'] as const) {
			const group = groupFieldset(page, legend);

			// Snapshot the initial "active" state so we can compare it to the
			// result of "Select active" later.
			const initialActive = await itemCheckboxes(group).evaluateAll((els) =>
				(els as HTMLInputElement[]).map((el) => el.checked),
			);

			await bulkAction(group, 'Select all').click();
			await assertChecked(group, 'all');

			await bulkAction(group, 'Deselect all').click();
			await assertChecked(group, 'none');

			await bulkAction(group, 'Select active').click();
			const afterSelectActive = await itemCheckboxes(group).evaluateAll((els) =>
				(els as HTMLInputElement[]).map((el) => el.checked),
			);
			expect(afterSelectActive, `${legend}: Select active restores the initial active set`).toEqual(initialActive);
		}

		// Tables only expose Select all / Deselect all (no concept of
		// "active") — exercise both.
		const tables = groupFieldset(page, 'Tables');
		await bulkAction(tables, 'Deselect all').click();
		await assertChecked(tables, 'none');
		await bulkAction(tables, 'Select all').click();
		await assertChecked(tables, 'all');

		// With everything deselected across all three groups (and uploads
		// off), `runDisabled` flips true and the Run button is no longer
		// clickable. The setup store derives the disabled state from
		// `anySelected || uploads`, so clear everything to hit that branch.
		for (const legend of ['Plugins', 'Themes', 'Tables'] as const) {
			await bulkAction(groupFieldset(page, legend), 'Deselect all').click();
		}
		await expect(page.getByLabel(/Include wp-content\/uploads/)).not.toBeChecked();
		await expect(runButton).toBeDisabled();

		// Sanity: flipping uploads on by itself re-enables Run, confirming
		// the disabled state was bound to selection state and not stuck.
		await page.getByLabel(/Include wp-content\/uploads/).check();
		await expect(runButton).toBeEnabled();
	});

	test('Setup → Run with only uploads selected forwards an uploads-only manifest', async ({ page }) => {
		await page.goto(setupPageUrl());

		const runButton = page.getByRole('button', { name: 'Run' });
		await expect(runButton).toBeEnabled();

		for (const legend of ['Plugins', 'Themes', 'Tables'] as const) {
			await bulkAction(groupFieldset(page, legend), 'Deselect all').click();
		}
		await page.getByLabel(/Include wp-content\/uploads/).check();
		await expect(runButton).toBeEnabled();

		const navigation = page.waitForURL((u) => u.searchParams.has('manifest'));
		await runButton.click();
		await navigation;

		const manifest = JSON.parse(new URL(page.url()).searchParams.get('manifest') ?? '{}') as {
			plugins: string[];
			themes: string[];
			tables: string[];
			uploads: boolean;
		};
		expect(manifest.uploads).toBe(true);
		expect(manifest.plugins).toEqual([]);
		expect(manifest.themes).toEqual([]);
		expect(manifest.tables).toEqual([]);
	});

	test('Individual row toggle drives Run-enabled state and the resulting manifest', async ({ page }) => {
		await page.goto(setupPageUrl());

		const runButton = page.getByRole('button', { name: 'Run' });
		await expect(runButton).toBeEnabled();

		// Start from an empty selection so the only way Run can re-enable
		// is via the single-row check we exercise below.
		for (const legend of ['Plugins', 'Themes', 'Tables'] as const) {
			await bulkAction(groupFieldset(page, legend), 'Deselect all').click();
		}
		await expect(runButton).toBeDisabled();

		// performance-lab is seeded by the wp-env setup project; its
		// `id` is the entry path "performance-lab/load.php" (see
		// `buildItems` in src/setup.ts), which is what lands in the
		// manifest array.
		const plugins = groupFieldset(page, 'Plugins');
		const perfLabRow = plugins.locator('ul li').filter({ hasText: 'Performance Lab' });
		const perfLabBox = perfLabRow.getByRole('checkbox');
		await perfLabBox.check();
		await expect(perfLabBox).toBeChecked();
		await expect(runButton).toBeEnabled();

		const navigation = page.waitForURL((u) => u.searchParams.has('manifest'));
		await runButton.click();
		await navigation;

		const manifest = JSON.parse(new URL(page.url()).searchParams.get('manifest') ?? '{}') as {
			plugins: string[];
			themes: string[];
			tables: string[];
			uploads: boolean;
		};
		expect(manifest.plugins).toEqual(['performance-lab/load.php']);
		expect(manifest.themes).toEqual([]);
		expect(manifest.tables).toEqual([]);
		expect(manifest.uploads).toBe(false);
	});
});
