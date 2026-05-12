import { expect, test } from '@playwright/test';
import { loginAsAdmin, runPageUrl } from '../helpers/wp-admin.js';
import { urlInput, waitForSandboxReady } from '../helpers/sandbox.js';

const QUICK_LINKS: ReadonlyArray<{ label: string; path: string }> = [
	{ label: 'Homepage', path: '/' },
	{ label: 'Dashboard', path: '/wp-admin/' },
	{ label: 'Site Editor', path: '/wp-admin/site-editor.php' },
	{ label: 'New Post', path: '/wp-admin/post-new.php' },
	{ label: 'Plugins', path: '/wp-admin/plugins.php' },
	{ label: 'Themes', path: '/wp-admin/themes.php' },
];

test.describe('Quick links menu', () => {
	test('renders all quick links and navigates to each', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto(runPageUrl());
		await waitForSandboxReady(page);

		const input = urlInput(page);
		const menu = page.locator('#lse-url-menu');

		for (const link of QUICK_LINKS) {
			// Re-open the menu each iteration: clicking a menu item closes it
			// via the `urlMenuOpen` signal flip in `quickNavigate`.
			await input.click();
			await expect(menu).toBeVisible();

			const item = menu.getByRole('menuitem', { name: new RegExp(`^${escapeRegex(link.label)}`) });
			await expect(item).toBeVisible();
			await item.click();

			await expect(menu).toBeHidden();
			await expect(input).toHaveValue(new RegExp(escapeRegex(link.path)));
		}
	});
});

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
