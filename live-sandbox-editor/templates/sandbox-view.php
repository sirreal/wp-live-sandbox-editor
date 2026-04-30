<?php
/**
 * Sandbox view template — full DOM rendered server-side. The Interactivity
 * API hydrates URL bar / status / loading bindings from the registered
 * `live-sandbox-editor/sandbox` store. Empty containers (`#lse-monaco`,
 * `#lse-file-tree-body`, `#lse-tabs`, `#lse-preview-iframe`,
 * `#lse-drag-handle`) are populated by imperative TS modules (Monaco,
 * file-explorer, app drag handle, playground client).
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor;

\defined( 'ABSPATH' ) || exit;

?>
<div id="live-sandbox-editor-root" data-wp-interactive="live-sandbox-editor/sandbox">
	<div class="lse-toolbar">
		<button
			type="button"
			class="lse-toolbar-btn"
			data-wp-on--click="actions.toggleEditor"
			data-wp-bind--disabled="state.notReady"
			data-wp-bind--aria-pressed="state.editorOpen"
			disabled
			aria-label="Toggle code editor"
		><span class="dashicons dashicons-editor-code" aria-hidden="true"></span></button>
		<button
			type="button"
			class="lse-toolbar-btn"
			data-wp-on--click="actions.refresh"
			data-wp-bind--disabled="state.notReady"
			disabled
			aria-label="Refresh"
		>↺</button>
		<form class="lse-url-form" data-wp-on--submit="actions.navigate">
			<input
				type="text"
				class="lse-url-input"
				placeholder="/wp-admin/"
				data-wp-bind--value="state.url"
				data-wp-bind--disabled="state.notReady"
				data-wp-on--input="actions.setUrl"
				aria-label="URL to visit in the playground"
				autocomplete="off"
				spellcheck="false"
				disabled
			>
		</form>
	</div>
	<div
		class="lse-main"
		data-wp-class--editor-open="state.editorOpen"
		data-wp-watch="callbacks.onEditorOpenChange"
	>
		<div class="lse-editor-pane">
			<div class="lse-file-tree">
				<div class="lse-file-tree-header">Files</div>
				<div id="lse-file-tree-body" class="lse-file-tree-body" tabindex="-1"></div>
			</div>
			<div class="lse-monaco-section">
				<div id="lse-tabs" class="lse-tabs"></div>
				<div id="lse-monaco" class="lse-monaco-container"></div>
			</div>
		</div>
		<div id="lse-drag-handle" class="lse-drag-handle"></div>
		<div class="lse-preview-pane">
			<iframe id="lse-preview-iframe" class="lse-preview-iframe" allow="cross-origin-isolated"></iframe>
		</div>
	</div>
	<div class="lse-status-bar">
		<span class="lse-status-indicator">● <span data-wp-text="state.statusText"></span></span>
	</div>
	<div id="lse-loading" class="lse-loading" data-wp-class--hidden="state.isReady">
		<div class="lse-spinner"></div>
		<span data-wp-text="state.statusText"></span>
	</div>
</div>
