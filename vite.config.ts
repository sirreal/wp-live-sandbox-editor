import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		monacoEditorPlugin({
			languageWorkers: [
				'editorWorkerService',
				'typescript',
				'css',
				'json',
				'html',
			],
		}),
	],
	build: {
		outDir: 'live-sandbox-editor/build',
		emptyOutDir: true,
		rollupOptions: {
			input: 'src/main.ts',
			output: {
				entryFileNames: 'main.js',
				chunkFileNames: '[name]-[hash].js',
				assetFileNames: '[name][extname]',
			},
		},
	},
});
