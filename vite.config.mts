import { defineConfig } from 'vite';
import monacoEditorPluginPkg from 'vite-plugin-monaco-editor';

// `vite-plugin-monaco-editor` is published as CJS with `exports.default`;
// under ESM the default import resolves to the namespace, not the function.
const monacoEditorPlugin = (
	monacoEditorPluginPkg as unknown as { default: typeof monacoEditorPluginPkg }
).default;

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
