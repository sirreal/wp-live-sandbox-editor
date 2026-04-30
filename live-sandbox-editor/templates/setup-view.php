<?php
/**
 * Setup view template — checkbox UI to scope the sync manifest. Populates
 * from the `/sync-manifest` REST endpoint via `live-sandbox-editor/setup`
 * Interactivity store ({@see src/setup.ts}). The Run button navigates to
 * the run admin page with the resolved manifest as a `?manifest=<json>`
 * query parameter.
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor;

\defined( 'ABSPATH' ) || exit;

?>
<div id="lse-setup-root" class="lse-setup" data-wp-interactive="live-sandbox-editor/setup">
	<h1><?php esc_html_e( 'Configure sandbox sync', 'live-sandbox-editor' ); ?></h1>
	<p class="lse-setup-help">
		<?php esc_html_e( 'Pick what to sync into the sandbox. Defaults match the current behavior.', 'live-sandbox-editor' ); ?>
	</p>

	<p data-wp-class--lse-hidden="!state.loading"><?php esc_html_e( 'Loading available items…', 'live-sandbox-editor' ); ?></p>

	<div data-wp-class--lse-hidden="!state.loadError">
		<p><?php esc_html_e( 'Failed to load.', 'live-sandbox-editor' ); ?></p>
		<button type="button" class="button" data-wp-on--click="actions.retry">
			<?php esc_html_e( 'Retry', 'live-sandbox-editor' ); ?>
		</button>
	</div>

	<div data-wp-class--lse-hidden="state.loading">
		<fieldset class="lse-setup-group">
			<legend><?php esc_html_e( 'Plugins', 'live-sandbox-editor' ); ?></legend>
			<ul>
				<template data-wp-each--item="state.plugins">
					<li>
						<label>
							<input type="checkbox" data-wp-bind--checked="context.item.selected" data-wp-on--change="actions.toggleItem">
							<span data-wp-text="context.item.label"></span>
						</label>
					</li>
				</template>
			</ul>
		</fieldset>

		<fieldset class="lse-setup-group">
			<legend><?php esc_html_e( 'Themes', 'live-sandbox-editor' ); ?></legend>
			<ul>
				<template data-wp-each--item="state.themes">
					<li>
						<label>
							<input type="checkbox" data-wp-bind--checked="context.item.selected" data-wp-on--change="actions.toggleItem">
							<span data-wp-text="context.item.label"></span>
						</label>
					</li>
				</template>
			</ul>
		</fieldset>

		<fieldset class="lse-setup-group">
			<legend><?php esc_html_e( 'Tables', 'live-sandbox-editor' ); ?></legend>
			<ul>
				<template data-wp-each--item="state.tables">
					<li>
						<label>
							<input type="checkbox" data-wp-bind--checked="context.item.selected" data-wp-on--change="actions.toggleItem">
							<span data-wp-text="context.item.label"></span>
						</label>
					</li>
				</template>
			</ul>
		</fieldset>

		<fieldset class="lse-setup-group">
			<legend><?php esc_html_e( 'Uploads', 'live-sandbox-editor' ); ?></legend>
			<label>
				<input type="checkbox" data-wp-bind--checked="state.uploads" data-wp-on--change="actions.toggleUploads">
				<?php esc_html_e( 'Include wp-content/uploads', 'live-sandbox-editor' ); ?>
			</label>
		</fieldset>

		<p>
			<button type="button" class="button button-primary" data-wp-bind--disabled="state.runDisabled" data-wp-on--click="actions.run">
				<?php esc_html_e( 'Run', 'live-sandbox-editor' ); ?>
			</button>
		</p>
	</div>
</div>
