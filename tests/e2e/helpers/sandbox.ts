import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const READY_TIMEOUT = 4 * 60 * 1000;

/**
 * Wait until the sandbox has finished booting Playground and applying
 * the post-import fixups.
 *
 * Signals chosen are DOM-state, sticky derivatives of `state.isReady`:
 * the loading overlay's `data-wp-class--hidden="state.isReady"` flips on
 * once and never reverts, and the URL input's
 * `data-wp-bind--disabled="state.notReady"` enables once and stays
 * enabled. Status text is intentionally NOT asserted here — the
 * test-upgrade flow in src/store.ts overwrites "Ready" with
 * "Preparing upgrade test…" on the next microtask, so a
 * `toHaveText('Ready')` poll races and frequently misses.
 */
export async function waitForSandboxReady(page: Page, timeout = READY_TIMEOUT): Promise<void> {
	await expect(page.locator('#live-sandbox-editor-root')).toBeVisible({ timeout: 30 * 1000 });
	await expect(page.locator('#lse-loading')).toHaveClass(/(^|\s)hidden(\s|$)/, { timeout });
	await expect(urlInput(page)).toBeEnabled({ timeout });
}

export function statusText(page: Page): Locator {
	return page.locator('.lse-status-indicator span').last();
}

export function urlInput(page: Page): Locator {
	return page.locator('.lse-url-input');
}
