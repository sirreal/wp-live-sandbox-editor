import type { PlaygroundClient } from '@wp-playground/client';

export async function listDir(
	client: PlaygroundClient,
	path: string,
): Promise<string[]> {
	return client.listFiles(path, { prependPath: true });
}

export async function readFile(
	client: PlaygroundClient,
	path: string,
): Promise<string> {
	return client.readFileAsText(path);
}

export async function writeFile(
	client: PlaygroundClient,
	path: string,
	content: string | Uint8Array,
): Promise<void> {
	return client.writeFile(path, content);
}

export async function isDirectory(
	client: PlaygroundClient,
	path: string,
): Promise<boolean> {
	return client.isDir(path);
}

export async function ensureDir(
	client: PlaygroundClient,
	path: string,
): Promise<void> {
	const exists = await client.fileExists(path);
	if (!exists) {
		await client.mkdir(path);
	}
}
