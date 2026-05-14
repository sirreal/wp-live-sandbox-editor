/**
 * Subsite admin on /site2/ visits the Setup page. The Tables section
 * is rendered from the `/sync-manifest` response — globals and
 * other subsites' tables must never appear as options, otherwise a
 * non-super-admin could check them and have them sent to `/sync-db`
 * (where `filter_requested_tables` is the last line of defence).
 *
 * Asserts every table checkbox's accessible name starts with the
 * current site's prefix (`wp_2_`). Catches both backend regressions
 * (defaults widened) and UI regressions (picker ignores backend
 * gating).
 */
import { expect, test } from '@playwright/test';
import { setupPageUrl, SITE_ADMIN_STORAGE_STATE } from '../../helpers/wp-admin.js';

test.use({ storageState: SITE_ADMIN_STORAGE_STATE });

test('subsite admin Setup tables list contains only this-site blog tables', async ({ page }) => {
	await page.goto(setupPageUrl('/site2'));

	// `<fieldset><legend>Tables</legend>…</fieldset>` exposes as a
	// `group` with accessible name "Tables" — see live-sandbox-editor/
	// templates/setup-view.php. The Interactivity API hydrates the
	// checkbox list async after `/sync-manifest` returns, so wait
	// until the first row is visible before enumerating.
	const tablesGroup = page.getByRole('group', { name: 'Tables' });
	await expect(tablesGroup).toBeVisible();
	const checkboxes = tablesGroup.getByRole('checkbox');
	await expect(checkboxes.first()).toBeVisible();

	const names = await checkboxes.evaluateAll((nodes) =>
		nodes.map((el) => (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? ''),
	);
	expect(names.length).toBeGreaterThan(0);
	for (const name of names) {
		expect(name, `Setup tables list leaked a non-/site2 table: ${name}`).toMatch(
			/^wp_2_[A-Za-z0-9_]+$/,
		);
	}
});
