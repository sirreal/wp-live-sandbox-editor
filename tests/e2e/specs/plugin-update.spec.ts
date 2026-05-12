import { expect, test } from '@playwright/test';
import { getInstalledPluginVersion } from '../helpers/wp-cli.js';
import { loginAsAdmin } from '../helpers/wp-admin.js';
import { statusText, waitForSandboxReady } from '../helpers/sandbox.js';

const PERFORMANCE_LAB_ENTRY = 'performance-lab/load.php';

// Failure-mode note for whoever lands here on a red CI:
// This spec is a real-bug detector for the host→Playground upgrade
// flow, not just a UI assertion. If `statusText` ends up containing
// "Upgrade test failed: No upgrade link found on plugins.php…", the
// sandbox booted and synced, but Playground's plugins.php didn't
// render the upgrade row for the entry the test transferred. Causes
// observed in practice:
//   - `_site_transient_update_plugins` row not surviving the
//     wp_options dump → import path (Reprint exporter / SQLite
//     reimport stripping FROM_BASE64'd serialized data).
//   - Playground re-running `wp_update_plugins()` on first admin
//     render and overwriting the synced transient with its own
//     (possibly empty) result.
// Either is upstream of this test — investigate the plugin's sync
// pipeline before relaxing the assertion.
test.describe('Plugin update in sandbox', () => {
	test('runs upgrade via in-row link, leaves host plugin untouched', async ({ page }) => {
		const versionBefore = getInstalledPluginVersion(PERFORMANCE_LAB_ENTRY);

		await loginAsAdmin(page);
		await page.goto('/wp-admin/plugins.php');

		// The host-side `in_plugin_update_message-<entry>` action appends the
		// "test the plugin update in the sandbox" anchor inside the per-row
		// update message. Match by the data attribute so the assertion fails
		// loudly if the renderer drops the marker.
		const upgradeLink = page.locator(`a.lse-test-upgrade-link[data-lse-test-upgrade="${PERFORMANCE_LAB_ENTRY}"]`);
		await expect(upgradeLink).toBeVisible({ timeout: 30 * 1000 });
		await upgradeLink.click();

		// Run page should boot with testUpgrade in the URL.
		await expect.poll(() => new URL(page.url()).searchParams.get('testUpgrade')).toBe(PERFORMANCE_LAB_ENTRY);

		// Wait until the sandbox is far enough along that the upgrade flow
		// completed. `runTestUpgrade` sets either of these terminal statuses;
		// poll for the upgrade-in-progress label which is the success signal.
		await waitForSandboxReady(page).catch(() => {
			// `runTestUpgrade` clobbers the "Ready" status with its own
			// progress message, so a missed "Ready" isn't a failure. Fall
			// through to the upgrade-state assertion below.
		});
		await expect(statusText(page)).toContainText(/Upgrade in progress|Upgrade test failed|Preparing upgrade test/i, {
			timeout: 4 * 60 * 1000,
		});
		await expect(statusText(page)).not.toContainText(/failed/i);

		const versionAfter = getInstalledPluginVersion(PERFORMANCE_LAB_ENTRY);
		expect(versionAfter, 'host plugin version must not change').toBe(versionBefore);
	});
});
