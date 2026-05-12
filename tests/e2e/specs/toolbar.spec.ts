import { expect, test } from '@playwright/test';
import { runPageUrl } from '../helpers/wp-admin.js';
import { urlInput, waitForSandboxReady } from '../helpers/sandbox.js';

test.describe('Sandbox toolbar', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(runPageUrl());
		await waitForSandboxReady(page);
	});

	test('URL form submit navigates the Playground iframe', async ({ page }) => {
		// users.php is always present in a fresh WP install and isn't the
		// boot URL (`/wp-admin/`), so a successful submit moves the frame
		// to a screen we can identify by its admin heading.
		const targetPath = '/wp-admin/users.php';

		const input = urlInput(page);
		await input.fill(targetPath);
		await input.press('Enter');

		// Strongest user-visible signal that `client.goTo(targetPath)`
		// completed: the nested WP frame is rendering the Users admin
		// screen, whose H1 is exactly "Users". Web-first assertion via
		// frameLocator chains auto-retries while Playground boots.
		const wpFrame = page.frameLocator('#lse-preview-iframe').frameLocator('iframe');
		await expect(wpFrame.locator('h1.wp-heading-inline')).toHaveText('Users');
	});

	test('Refresh re-navigates the Playground iframe at the current URL', async ({ page }) => {
		const refresh = page.locator('button[data-wp-on--click="actions.refresh"]');
		await expect(refresh).toBeEnabled();

		// `actions.refresh` calls `client.goTo(currentUrl)`; the iframe
		// reloads but its URL doesn't change, and the LSE store doesn't
		// touch any externally visible state. Strongest reload signal we
		// can get cross-origin: plant a marker element inside the nested
		// WP document and assert it's gone after the click. Because the
		// reload replaces the document, the marker disappears iff the
		// goTo round-trip actually happened.
		const playgroundFrame = page.frameLocator('#lse-preview-iframe').frameLocator('iframe');
		await expect(playgroundFrame.locator('#wpadminbar')).toBeVisible();

		await playgroundFrame.locator('body').evaluate((body) => {
			const el = document.createElement('div');
			el.id = 'lse-refresh-marker';
			body.appendChild(el);
		});

		await refresh.click();

		await expect(playgroundFrame.locator('#lse-refresh-marker')).toHaveCount(0);
		await expect(playgroundFrame.locator('#wpadminbar')).toBeVisible();
	});

	test('Editor toggle opens and closes the editor pane', async ({ page }) => {
		const toggle = page.locator('button[data-wp-on--click="actions.toggleEditor"]');
		const main = page.locator('.lse-main');

		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await expect(main).not.toHaveClass(/(^|\s)editor-open(\s|$)/);

		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await expect(main).toHaveClass(/(^|\s)editor-open(\s|$)/);

		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await expect(main).not.toHaveClass(/(^|\s)editor-open(\s|$)/);
	});

	test('Theme toggle switches color scheme across System, Light and Dark', async ({ page }) => {
		// The radiogroup lives inside `.lse-editor-pane`, which is
		// `display:none` until `.lse-main.editor-open` flips on. Open
		// the editor first so the radios are visible / clickable.
		await page.locator('button[data-wp-on--click="actions.toggleEditor"]').click();
		await expect(page.locator('.lse-main')).toHaveClass(/(^|\s)editor-open(\s|$)/);

		const radiogroup = page.locator('.lse-theme-toggle');
		const option = (label: 'System' | 'Light' | 'Dark') =>
			radiogroup.getByRole('radio', { name: label, exact: true });
		const root = page.locator('#live-sandbox-editor-root');

		// `setThemeMode` short-circuits when the value matches the
		// current mode (default is 'system' unless localStorage carries
		// another choice), so always step through Light → Dark → System
		// to guarantee each click flips state.
		await option('Light').click();
		await expect(option('Light')).toBeChecked();
		await expect(option('Dark')).not.toBeChecked();
		await expect(option('System')).not.toBeChecked();
		await expect(option('Light')).toHaveClass(/(^|\s)is-active(\s|$)/);
		await expect(root).toHaveAttribute('style', /color-scheme:\s*light(?!\s*dark)/);

		await option('Dark').click();
		await expect(option('Dark')).toBeChecked();
		await expect(option('Dark')).toHaveClass(/(^|\s)is-active(\s|$)/);
		await expect(root).toHaveAttribute('style', /color-scheme:\s*dark/);

		await option('System').click();
		await expect(option('System')).toBeChecked();
		await expect(option('System')).toHaveClass(/(^|\s)is-active(\s|$)/);
		// `colorScheme` resolves to "light dark" in system mode.
		await expect(root).toHaveAttribute('style', /color-scheme:\s*light\s+dark/);
	});
});
