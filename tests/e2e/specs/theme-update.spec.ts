import { expect, test } from '@playwright/test';
import { getInstalledThemeVersion } from '../helpers/wp-cli.js';
import { statusText, waitForSandboxReady } from '../helpers/sandbox.js';

const THEME_STYLESHEET = 'twentyeleven';

// Host-side theme-update entry point: `inc/test-upgrade.php`
// `render_theme_link()` emits
//   <a class="lse-test-upgrade-link" data-lse-test-theme-upgrade="<slug>" href="…?testThemeUpgrade=<slug>">
// inside themes.php's per-card "New version available" notice (via
// `wp_prepare_themes_for_js` injection). Same shape as the plugin spec
// but distinct attribute + query param.
test.describe('Theme update in sandbox', () => {
	test('runs upgrade via link on themes.php (all themes), leaves host theme untouched', async ({ page }) => {
		const versionBefore = getInstalledThemeVersion(THEME_STYLESHEET);

await page.goto('/wp-admin/themes.php');

		const upgradeLink = page.locator(`a.lse-test-upgrade-link[data-lse-test-theme-upgrade="${THEME_STYLESHEET}"]`);
		await expect(upgradeLink).toBeVisible();
		await upgradeLink.click();

		await expect.poll(() => new URL(page.url()).searchParams.get('testThemeUpgrade')).toBe(THEME_STYLESHEET);

		await waitForSandboxReady(page);
		await expect(statusText(page)).toContainText(/Upgrade in progress|Preparing upgrade test/i, {
			timeout: 4 * 60 * 1000,
		});
		await expect(statusText(page)).not.toContainText(/failed/i);

		const versionAfter = getInstalledThemeVersion(THEME_STYLESHEET);
		expect(versionAfter, 'host theme version must not change').toBe(versionBefore);
	});

	test('runs upgrade via link on the single-theme view, leaves host theme untouched', async ({ page }) => {
		const versionBefore = getInstalledThemeVersion(THEME_STYLESHEET);

// themes.php?theme=<slug> opens the per-theme details modal on
		// load (WP's themes-grid JS reads the query param and shows the
		// overlay). The injected sandbox-link sits inside the same
		// "New version available" notice as the grid card.
		await page.goto(`/wp-admin/themes.php?theme=${THEME_STYLESHEET}`);

		const modalLink = page
			.locator('.theme-overlay, #theme-overlay')
			.locator(`a.lse-test-upgrade-link[data-lse-test-theme-upgrade="${THEME_STYLESHEET}"]`);
		await expect(modalLink).toBeVisible();
		await modalLink.click();

		await expect.poll(() => new URL(page.url()).searchParams.get('testThemeUpgrade')).toBe(THEME_STYLESHEET);
		await waitForSandboxReady(page);
		await expect(statusText(page)).toContainText(/Upgrade in progress|Preparing upgrade test/i, {
			timeout: 4 * 60 * 1000,
		});
		await expect(statusText(page)).not.toContainText(/failed/i);

		const versionAfter = getInstalledThemeVersion(THEME_STYLESHEET);
		expect(versionAfter, 'host theme version must not change').toBe(versionBefore);
	});
});
