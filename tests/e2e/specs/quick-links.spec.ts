import { expect, test } from '@playwright/test';
import { runPageUrl } from '../helpers/wp-admin.js';
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
		await page.goto(runPageUrl());
		await waitForSandboxReady(page);

		const input = urlInput(page);
		const menu = page.locator('#lse-url-menu');

		for (const link of QUICK_LINKS) {
			// Re-open the menu each iteration: clicking a menu item closes it
			// via the `urlMenuOpen` signal flip in `quickNavigate`.
			await input.click();
			await expect(menu).toBeVisible();

			// Match the menuitem whose label span text equals `link.label`
			// exactly. Scoping to the label span avoids matching against the
			// menuitem's full accessible name, which concatenates the label
			// and path spans.
			const item = menu.locator('.lse-url-menu-item').filter({
				has: page.getByText(link.label, { exact: true }),
			});
			await item.click();

			await expect(menu).toBeHidden();
			// `quickNavigate` writes the path into `state.url` literally —
			// assert against the exact string.
			await expect(input).toHaveValue(link.path);
		}
	});
});
