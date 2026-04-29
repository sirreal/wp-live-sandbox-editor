<?php
/**
 * Wire format for chunked sync streams.
 *
 * Stream is text (ASCII) interleaving sentinel markers with base64 payload.
 * Markers begin with `\n#LSE:` — characters that cannot appear in base64
 * output, so the receiver can scan unambiguously without escaping.
 *
 *   \n#LSE:FILE:<urlencoded path>\n   start a file record
 *   \n#LSE:SQL\n                       start a SQL record
 *   \n#LSE:END\n                       end of current record
 *   \n#LSE:DONE\n                      end of stream
 *   \n#LSE:ERR:<urlencoded msg>\n      fatal error (terminal)
 *
 * Payload between START and END is one continuous base64-encoded byte
 * stream. To allow streaming concatenation, the producer encodes only
 * 3-byte-aligned prefixes mid-record and emits the (padded) tail on END;
 * the receiver can therefore decode 4-char-aligned chunks as they arrive.
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor\Sync_Stream;

const MARKER_FILE = 'FILE';
const MARKER_SQL  = 'SQL';
const MARKER_END  = 'END';
const MARKER_DONE = 'DONE';
const MARKER_ERR  = 'ERR';

/**
 * Disable buffering, compression and timeouts so the body is streamed
 * unmodified. Mirrors the previous NDJSON setup.
 */
function setup(): void {
	while ( ob_get_level() > 0 ) {
		ob_end_clean();
	}
	// phpcs:ignore WordPress.PHP.IniSet.Risky,WordPress.PHP.NoSilencedErrors.Discouraged -- intentional: streaming response, output buffering / compression must be off; ini_set may be disabled on some hosts.
	@ini_set( 'zlib.output_compression', '0' );
	if ( function_exists( 'apache_setenv' ) ) {
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_apache_setenv -- intentional: streaming response, gzip must be off; apache_setenv is the only way to force this on mod_php.
		@apache_setenv( 'no-gzip', '1' );
	}
	// Streaming a full export comfortably exceeds the default 30s
	// max_execution_time. Disable up front and reset periodically — some
	// hosts silently re-impose a per-iteration timer.
	// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- set_time_limit may be disabled in php.ini; the silence is the intended fallback.
	@set_time_limit( 0 );
	ignore_user_abort( true );
	if ( function_exists( 'session_write_close' ) ) {
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- harmless if no session is active.
		@session_write_close();
	}
	nocache_headers();
	header( 'Content-Type: application/octet-stream' );
	header( 'Cache-Control: no-cache, no-store, no-transform, must-revalidate' );
	header( 'Pragma: no-cache' );
	header( 'X-Accel-Buffering: no' );
	header( 'Content-Encoding: identity' );
	header( 'X-Content-Type-Options: nosniff' );
}

/**
 * Emit a sentinel marker line.
 *
 * @param string      $name Marker name (one of the MARKER_* constants).
 * @param string|null $arg  Optional argument. URL-encoded so newlines/colons can't break framing.
 */
function emit_marker( string $name, ?string $arg = null ): void {
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- $name comes from MARKER_* constants; protocol is binary stream, not HTML.
	echo "\n#LSE:", $name;
	if ( null !== $arg ) {
		echo ':', rawurlencode( $arg );
	}
	echo "\n";
	flush();
}

/**
 * Streaming base64 encoder — buffers up to 2 unaligned bytes between calls
 * so concatenated output remains valid base64 (no mid-stream `=` padding).
 *
 * Usage:
 *   $b = new B64_Streamer();
 *   $b->feed($bytes_a);
 *   $b->feed($bytes_b);
 *   $b->finalize(); // flushes the remaining 1–2 bytes with padding
 */
// phpcs:disable Universal.Files.SeparateFunctionsFromOO.Mixed -- the streamer is the back end of the procedural emit_marker() above; same wire format, kept in one file for locality.

/**
 * Streaming base64 encoder. See file header for the full wire-format
 * contract; this class implements the per-record encoding side.
 */
final class B64_Streamer {
	/**
	 * Buffered tail of unaligned bytes from the previous `feed()` call.
	 *
	 * Up to 2 bytes that didn't fit a 3-byte base64 group are held here
	 * and prepended to the next chunk so the encoded stream stays valid
	 * with no mid-stream padding.
	 *
	 * @var string
	 */
	private string $tail = '';

	/**
	 * Append $bytes to the stream. Encodes 3-byte-aligned prefixes,
	 * buffers the remainder for the next call.
	 *
	 * @param string $bytes Raw bytes to encode.
	 */
	public function feed( string $bytes ): void {
		if ( '' === $bytes ) {
			return;
		}
		$buf = $this->tail . $bytes;
		$len = strlen( $buf );
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.math_intdiv
		$aligned    = intdiv( $len, 3 ) * 3;
		$this->tail = (string) substr( $buf, $aligned );
		if ( $aligned > 0 ) {
			// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode,WordPress.Security.EscapeOutput.OutputNotEscaped -- binary protocol, not HTML; base64 output is the intended wire format.
			echo base64_encode( substr( $buf, 0, $aligned ) );
		}
	}

	/**
	 * Flush the trailing 1–2 bytes (with padding) and the underlying
	 * output buffer.
	 */
	public function finalize(): void {
		if ( '' !== $this->tail ) {
			// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode,WordPress.Security.EscapeOutput.OutputNotEscaped -- see feed().
			echo base64_encode( $this->tail );
			$this->tail = '';
		}
		flush();
	}
}
