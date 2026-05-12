import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const READY_TIMEOUT = 4 * 60 * 1000;

/**
 * Wait until the sandbox status bar reports "Ready" and the loading overlay
 * has been hidden. Both signals are produced by `src/store.ts` once Playground
 * boots and the post-import fixups run.
 */
export async function waitForSandboxReady(page: Page, timeout = READY_TIMEOUT): Promise<void> {
	await expect(page.locator('#live-sandbox-editor-root')).toBeVisible({ timeout: 30 * 1000 });
	await expect(page.locator('#lse-loading')).toHaveClass(/(^|\s)hidden(\s|$)/, { timeout });
	await expect(statusText(page)).toHaveText('Ready', { timeout });
}

export function statusText(page: Page): Locator {
	return page.locator('.lse-status-indicator span').last();
}

export function urlInput(page: Page): Locator {
	return page.locator('.lse-url-input');
}
