import { expect, test } from '@playwright/test';
import { getInstalledThemeVersion } from '../helpers/wp-cli.js';
import { loginAsAdmin } from '../helpers/wp-admin.js';
import { statusText, waitForSandboxReady } from '../helpers/sandbox.js';

const THEME_STYLESHEET = 'twentyeleven';

// The host-side theme-update entry point mirrors `inc/test-upgrade.php`:
// a `[data-lse-test-upgrade="<stylesheet>"]` anchor pointing at the Run
// page with `?testUpgrade=<stylesheet>`. The feature is not implemented
// yet — these specs are marked `.fixme` so they're visible in the runner
// output but don't fail the suite. Drop `.fixme` once the link renders.
test.describe('Theme update in sandbox', () => {
	test.fixme('runs upgrade via link on themes.php (all themes), leaves host theme untouched', async ({ page }) => {
		const versionBefore = getInstalledThemeVersion(THEME_STYLESHEET);

		await loginAsAdmin(page);
		await page.goto('/wp-admin/themes.php');

		const upgradeLink = page.locator(`a.lse-test-upgrade-link[data-lse-test-upgrade="${THEME_STYLESHEET}"]`);
		await expect(upgradeLink).toBeVisible({ timeout: 30 * 1000 });
		await upgradeLink.click();

		await expect.poll(() => new URL(page.url()).searchParams.get('testUpgrade')).toBe(THEME_STYLESHEET);

		await waitForSandboxReady(page).catch(() => undefined);
		await expect(statusText(page)).toContainText(/Upgrade in progress|Preparing upgrade test/i, {
			timeout: 4 * 60 * 1000,
		});
		await expect(statusText(page)).not.toContainText(/failed/i);

		const versionAfter = getInstalledThemeVersion(THEME_STYLESHEET);
		expect(versionAfter, 'host theme version must not change').toBe(versionBefore);
	});

	test.fixme('runs upgrade via link on the single-theme view, leaves host theme untouched', async ({ page }) => {
		const versionBefore = getInstalledThemeVersion(THEME_STYLESHEET);

		await loginAsAdmin(page);
		await page.goto(`/wp-admin/theme-install.php?theme=${THEME_STYLESHEET}`);
		// The single-theme view is the themes.php modal that opens when the
		// user clicks a theme card. Open it through the theme detail URL so
		// the test doesn't rely on JS-driven modal state.
		await page.goto(`/wp-admin/themes.php?theme=${THEME_STYLESHEET}`);

		const upgradeLink = page.locator(`a.lse-test-upgrade-link[data-lse-test-upgrade="${THEME_STYLESHEET}"]`);
		await expect(upgradeLink).toBeVisible({ timeout: 30 * 1000 });
		await upgradeLink.click();

		await expect.poll(() => new URL(page.url()).searchParams.get('testUpgrade')).toBe(THEME_STYLESHEET);
		await waitForSandboxReady(page).catch(() => undefined);
		await expect(statusText(page)).toContainText(/Upgrade in progress|Preparing upgrade test/i, {
			timeout: 4 * 60 * 1000,
		});

		const versionAfter = getInstalledThemeVersion(THEME_STYLESHEET);
		expect(versionAfter, 'host theme version must not change').toBe(versionBefore);
	});
});
