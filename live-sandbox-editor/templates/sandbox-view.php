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

$quick_links = array(
	array(
		'label' => __( 'Homepage', 'live-sandbox-editor' ),
		'path'  => '/',
	),
	array(
		'label' => __( 'Dashboard', 'live-sandbox-editor' ),
		'path'  => '/wp-admin/',
	),
	array(
		'label' => __( 'Site Editor', 'live-sandbox-editor' ),
		'path'  => '/wp-admin/site-editor.php',
	),
	array(
		'label' => __( 'New Post', 'live-sandbox-editor' ),
		'path'  => '/wp-admin/post-new.php',
	),
	array(
		'label' => __( 'Plugins', 'live-sandbox-editor' ),
		'path'  => '/wp-admin/plugins.php',
	),
	array(
		'label' => __( 'Themes', 'live-sandbox-editor' ),
		'path'  => '/wp-admin/themes.php',
	),
);

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
			<div class="lse-url-form-group">
				<input
					type="text"
					class="lse-url-input"
					placeholder="/wp-admin/"
					data-wp-bind--value="state.url"
					data-wp-bind--disabled="state.notReady"
					data-wp-bind--aria-expanded="state.urlMenuOpen"
					data-wp-on--input="actions.setUrl"
					data-wp-on--focus="actions.openUrlMenu"
					aria-label="URL to visit in the playground"
					aria-haspopup="menu"
					aria-controls="lse-url-menu"
					autocomplete="off"
					spellcheck="false"
					disabled
				>
				<div
					id="lse-url-menu"
					class="lse-url-menu"
					role="menu"
					data-wp-class--open="state.urlMenuOpen"
					hidden
					data-wp-bind--hidden="!state.urlMenuOpen"
				>
					<?php foreach ( $quick_links as $link ) : ?>
						<button
							type="button"
							role="menuitem"
							class="lse-url-menu-item"
							data-wp-context="<?php echo esc_attr( wp_json_encode( array( 'path' => $link['path'] ) ) ); ?>"
							data-wp-on--click="actions.quickNavigate"
						>
							<span class="lse-url-menu-label"><?php echo esc_html( $link['label'] ); ?></span>
							<span class="lse-url-menu-path"><?php echo esc_html( $link['path'] ); ?></span>
						</button>
					<?php endforeach; ?>
				</div>
			</div>
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
