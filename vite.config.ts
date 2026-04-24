import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
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
	server: {
		watch: {
			// `.claude/worktrees/**` holds full git worktree copies of this
			// repo (including `src/`); without this rule chokidar treats
			// edits in a worktree as edits to the parent and fires HMR.
			ignored: ['**/.claude/**'],
		},
	},
	build: {
		outDir: 'live-sandbox-editor/build',
		emptyOutDir: true,
		sourcemap: true,
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
