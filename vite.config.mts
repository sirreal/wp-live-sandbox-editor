import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
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
		modulePreload: false,
		sourcemap: true,
		rollupOptions: {
			preserveEntrySignatures: 'exports-only',
			input: {
				main: 'src/main.ts',
				app: 'src/app.ts',
			},
			output: {
				entryFileNames: '[name].js',
				chunkFileNames: '[name]-[hash].js',
				assetFileNames: (assetInfo) =>
					assetInfo.name?.endsWith('.css') ? 'main.css' : '[name][extname]',
			},
		},
	},
});
