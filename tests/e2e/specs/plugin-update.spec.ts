import { expect, test } from '@playwright/test';
import { getInstalledPluginVersion } from '../helpers/wp-cli.js';
import { waitForSandboxReady } from '../helpers/sandbox.js';

const PERFORMANCE_LAB_ENTRY = 'performance-lab/load.php';

test.describe('Plugin update in sandbox', () => {
	test('runs upgrade via in-row link, leaves host plugin untouched', async ({ page }) => {
		const versionBefore = getInstalledPluginVersion(PERFORMANCE_LAB_ENTRY);

		await page.goto('/wp-admin/plugins.php');

		// The host-side `in_plugin_update_message-<entry>` action appends a
		// "Click here to test the new version before you upgrade." anchor
		// inside the per-row update message. Match by the data attribute
		// so the assertion fails loudly if the renderer drops the marker.
		const upgradeLink = page.locator(`a.lse-test-upgrade-link[data-lse-test-upgrade="${PERFORMANCE_LAB_ENTRY}"]`);
		await expect(upgradeLink).toBeVisible();
		await upgradeLink.click();

		// Run page should boot with testUpgrade in the URL.
		await expect.poll(() => new URL(page.url()).searchParams.get('testUpgrade')).toBe(PERFORMANCE_LAB_ENTRY);

		await waitForSandboxReady(page);

		// Real success signal: the Playground iframe reaches WP's upgrade
		// landing page for this plugin entry. The runtime nonce is unknown
		// ahead of time so we match on the action + plugin path and
		// require a hex `_wpnonce` to be present.
		const upgradeUrlPattern =
			/\/wp-admin\/update\.php\?action=upgrade-plugin&plugin=performance-lab%2Fload\.php&_wpnonce=[a-f0-9]+/;
		await expect
			.poll(() => page.frames().find((f) => upgradeUrlPattern.test(f.url()))?.url() ?? null, {
				timeout: 5 * 1000,
				message: 'Playground iframe should land on update.php?action=upgrade-plugin for this entry',
			})
			.toMatch(upgradeUrlPattern);

		// Upgrade completion is signalled inside the Playground WP frame
		// by the "Go to Plugins page" link rendered after a successful
		// update.php run.
		const playgroundFrame = page.frameLocator('#lse-preview-iframe').frameLocator('iframe');
		await expect(playgroundFrame.getByRole('link', { name: 'Go to Plugins page' })).toBeVisible({
			timeout: 5 * 1000,
		});

		const versionAfter = getInstalledPluginVersion(PERFORMANCE_LAB_ENTRY);
		expect(versionAfter, 'host plugin version must not change').toBe(versionBefore);
	});
});
