<?php
/**
 * Statement-side wrapper for `Wpdb_Pdo_Adapter`. Eagerly loads result rows
 * on `execute()` and serves them through `fetch()` / `fetchColumn()`.
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor;

class Wpdb_Pdo_Statement {

	/** @var \wpdb */
	private $wpdb;

	/** @var Wpdb_Pdo_Adapter */
	private $adapter;

	/** @var string */
	private $sql;

	/** @var array<int,array<string,mixed>> */
	private $rows = array();

	/** @var int */
	private $position = 0;

	/** @var array<int|string,mixed>|null */
	private $bound_params = null;

	public function __construct( \wpdb $wpdb, Wpdb_Pdo_Adapter $adapter, string $sql ) {
		$this->wpdb    = $wpdb;
		$this->adapter = $adapter;
		$this->sql     = $sql;
	}

	/**
	 * Substitute `?` and `:name` placeholders via the adapter's `quote()` and
	 * run through wpdb. Calling `wpdb::prepare()` here would re-escape the
	 * already-quoted values and reprocess `%` characters.
	 *
	 * @param array<int|string,mixed>|null $params Positional or named params.
	 * @throws \PDOException If wpdb reports an error or the query fails.
	 */
	public function execute( ?array $params = null ): bool {
		if ( null === $params && null !== $this->bound_params ) {
			$params = $this->bound_params;
		}

		$sql = ( null !== $params && count( $params ) > 0 )
			? $this->substitute_placeholders( $this->sql, $params )
			: $this->sql;

		// wpdb does not throw — clear last_error first so we can detect a
		// fresh failure even when get_results returns an empty array.
		$this->wpdb->last_error = '';
		try {
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- placeholders already substituted via PDO::quote()-equivalent escaping above; calling wpdb::prepare() here would corrupt the SQL.
			$result = $this->wpdb->get_results( $sql, ARRAY_A );

			if ( '' !== (string) $this->wpdb->last_error ) {
				throw new \PDOException( $this->wpdb->last_error );
			}
			if ( ! is_array( $result ) ) {
				throw new \PDOException( 'wpdb query failed.' );
			}

			$this->rows     = $result;
			$this->position = 0;
		} finally {
			// wpdb otherwise retains last_result for the rest of the request,
			// which compounds memory pressure across 250-row BLOB batches.
			$this->wpdb->flush();
		}

		return true;
	}

	/**
	 * Single forward-pass placeholder substitution skipping string literals.
	 * Emits the result into one freshly built buffer so the source SQL is
	 * walked exactly once and no intermediate copies are made.
	 *
	 * @param array<int|string,mixed> $params Positional and/or named params.
	 */
	private function substitute_placeholders( string $sql, array $params ): string {
		$out       = '';
		$len       = strlen( $sql );
		$in_single = false;
		$in_double = false;
		$pos_idx   = 0;
		// Sort named keys longest-first so `:id` cannot eat `:id2`.
		$named = array();
		foreach ( $params as $key => $value ) {
			if ( is_string( $key ) ) {
				$named[ $key ] = $value;
			}
		}
		uksort(
			$named,
			static function ( $a, $b ) {
				return strlen( $b ) - strlen( $a );
			}
		);

		for ( $i = 0; $i < $len; $i++ ) {
			$ch = $sql[ $i ];

			if ( $in_single ) {
				$out .= $ch;
				if ( "'" === $ch ) {
					$in_single = false;
				}
				continue;
			}
			if ( $in_double ) {
				$out .= $ch;
				if ( '"' === $ch ) {
					$in_double = false;
				}
				continue;
			}
			if ( "'" === $ch ) {
				$in_single = true;
				$out      .= $ch;
				continue;
			}
			if ( '"' === $ch ) {
				$in_double = true;
				$out      .= $ch;
				continue;
			}
			if ( '?' === $ch ) {
				if ( array_key_exists( $pos_idx, $params ) ) {
					$out .= $this->adapter->quote( $params[ $pos_idx ] );
				} else {
					$out .= $ch;
				}
				++$pos_idx;
				continue;
			}
			if ( ':' === $ch && ! empty( $named ) ) {
				$matched = false;
				foreach ( $named as $key => $value ) {
					$klen = strlen( $key );
					if ( substr( $sql, $i, $klen ) === $key ) {
						$out    .= $this->adapter->quote( $value );
						$i      += $klen - 1;
						$matched = true;
						break;
					}
				}
				if ( $matched ) {
					continue;
				}
			}
			$out .= $ch;
		}

		return $out;
	}

	/**
	 * @return array<string,mixed>|false Next row, or false when exhausted.
	 */
	public function fetch( int $mode = \PDO::FETCH_ASSOC ) {
		if ( $this->position >= count( $this->rows ) ) {
			return false;
		}
		return $this->rows[ $this->position++ ];
	}

	/**
	 * @return mixed|false
	 */
	public function fetchColumn( int $column_number = 0 ) {
		$row = $this->fetch();
		if ( false === $row ) {
			return false;
		}
		$values = array_values( $row );
		return $values[ $column_number ] ?? false;
	}

	/**
	 * @param int|string $parameter Positional index or `:name`.
	 * @param mixed      $value     Value to bind.
	 * @param int        $type      PDO param type — ignored: `quote()` infers
	 *                              from the PHP type and the producer never
	 *                              reads it back.
	 */
	public function bindValue( $parameter, $value, int $type = \PDO::PARAM_STR ): bool {
		if ( null === $this->bound_params ) {
			$this->bound_params = array();
		}
		$this->bound_params[ $parameter ] = $value;
		return true;
	}

	/**
	 * @throws \PDOException Always.
	 */
	public function __call( string $name, array $args ) {
		throw new \PDOException( 'Wpdb_Pdo_Statement does not implement ' . $name . '()' );
	}
}
