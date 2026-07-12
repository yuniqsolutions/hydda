/**
 * Telemetry for hydda stores — rich, zero-dependency, runtime-agnostic.
 *
 * One implementation shared by the SQLite engines (node/bun) and the web
 * engines. Everything is O(1) per recorded operation and bounded in memory:
 * - per-operation counters with min/max/avg and a log-scale latency
 *   histogram (p50/p90/p95/p99 estimated from buckets)
 * - byte accounting (serialized bytes in/out) and item counts for bulk ops
 * - cache hit/miss tracking
 * - per-namespace activity breakdown (bounded map)
 * - lifecycle counters (expirations, evictions, tombstones, compactions,
 *   migrations) fed by store events
 * - slow-operation capture ring and recent-error ring
 * - 60s rolling window for throughput (ops/sec, error rate, avg latency)
 * - Prometheus / OpenMetrics text exporter
 */
/** Operations tracked by telemetry */
export type TelemetryOp = "get" | "set" | "delete" | "has" | "getMany" | "setMany" | "deleteMany" | "batch" | "listKeys" | "listEntries" | "getSize" | "setExpiry" | "clearExpired" | "clearDeleted" | "clearNamespace" | "clearAll" | "evictLRU" | "listNamespaces" | "getNamespaceStats";
export interface TelemetryOptions {
	/**
	 * Master switch. When false every record call is a cheap no-op.
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Operations slower than this are captured in the slow-op ring.
	 * @default 100
	 */
	slowOpThresholdMs?: number;
	/**
	 * How many slow operations to retain.
	 * @default 50
	 */
	slowOpLogSize?: number;
	/**
	 * How many recent errors to retain.
	 * @default 25
	 */
	errorLogSize?: number;
	/**
	 * Track a per-namespace activity breakdown.
	 * @default true
	 */
	perNamespace?: boolean;
	/**
	 * Cap on distinct namespaces tracked (protects memory for
	 * namespace-heavy workloads; overflow is flagged in the snapshot).
	 * @default 256
	 */
	maxNamespaces?: number;
}
/** Extra context attached to a recorded operation */
export interface RecordOptions {
	/** Namespace the operation targeted */
	ns?: string;
	/** For reads: whether the lookup hit */
	hit?: boolean;
	/** Items given to the operation (bulk sizes, batch length) */
	items?: number;
	/** Items produced by the operation (rows returned) */
	itemsOut?: number;
	/** Serialized bytes written */
	bytesIn?: number;
	/** Serialized bytes read */
	bytesOut?: number;
	/** Free-form detail for slow-op entries (e.g. a key) */
	detail?: string;
}
export interface OpSnapshot {
	count: number;
	errors: number;
	totalMs: number;
	avgMs: number;
	minMs: number;
	maxMs: number;
	lastMs: number;
	lastAt: number;
	p50Ms: number;
	p90Ms: number;
	p95Ms: number;
	p99Ms: number;
	itemsIn: number;
	itemsOut: number;
	bytesIn: number;
	bytesOut: number;
	/** Cumulative counts per LATENCY_BUCKETS_MS bucket (+Inf last) */
	histogram: number[];
}
export interface NamespaceActivity {
	ops: number;
	reads: number;
	writes: number;
	deletes: number;
	hits: number;
	misses: number;
	bytesIn: number;
	bytesOut: number;
	lastAt: number;
}
export interface SlowOpEntry {
	op: TelemetryOp;
	ms: number;
	at: number;
	ns?: string;
	detail?: string;
}
export interface ErrorEntry {
	op: string;
	message: string;
	at: number;
}
export interface TelemetrySnapshot {
	enabled: boolean;
	startedAt: number;
	capturedAt: number;
	uptimeMs: number;
	totals: {
		ops: number;
		errors: number;
		bytesRead: number;
		bytesWritten: number;
		itemsRead: number;
		itemsWritten: number;
	};
	/** Rolling windows computed from a shared 1h per-second ring */
	windows: Record<"1m" | "5m" | "15m" | "1h", {
		seconds: number;
		ops: number;
		errors: number;
		opsPerSecond: number;
		avgMs: number;
	}>;
	/** Alias of windows['1m'] (backward compatibility) */
	window: {
		seconds: number;
		ops: number;
		errors: number;
		opsPerSecond: number;
		avgMs: number;
	};
	cache: {
		hits: number;
		misses: number;
		hitRate: number;
	};
	operations: Partial<Record<TelemetryOp, OpSnapshot>>;
	lifecycle: {
		expirations: number;
		evictions: number;
		tombstonesWritten: number;
		compactions: number;
		compactionKeysProcessed: number;
		migrations: number;
		lastCompactionAt: number;
		lastMigration?: {
			fromVersion: number;
			toVersion: number;
			rows: number;
			ms: number;
			at: number;
		};
	};
	namespaces: Record<string, NamespaceActivity>;
	/** True when maxNamespaces was hit and some namespaces are untracked */
	namespacesTruncated: boolean;
	slowOps: SlowOpEntry[];
	recentErrors: ErrorEntry[];
}
/**
 * Minimal Analytics surface used by mirrorTo() — avoids a hard dependency.
 */
export interface TelemetryMirror {
	increment(metric: string, count?: number, options?: {
		dimensions?: Record<string, string>;
		at?: number;
	}): void;
	readonly namespace?: string;
}
declare class Telemetry {
	private options;
	private startedAt;
	private ops;
	private nsActivity;
	private nsTruncated;
	private cacheHits;
	private cacheMisses;
	private expirations;
	private evictions;
	private tombstonesWritten;
	private compactions;
	private compactionKeysProcessed;
	private lastCompactionAt;
	private migrations;
	private lastMigration?;
	private slowOps;
	private recentErrors;
	/** 1s slots: [ops, errors, totalMs] */
	private window;
	private windowEpochSec;
	private mirror?;
	private mirrorPrefix;
	private mirrorIgnoreNs?;
	/** Optional engine-level byte counters merged into snapshot totals */
	private byteSource?;
	constructor(options?: TelemetryOptions);
	get enabled(): boolean;
	enable(): void;
	disable(): void;
	/**
	 * Mirror operation counts into an Analytics instance so store activity
	 * gains persistent day/week/month/year ranges:
	 * `<prefix>ops` with an `op` dimension, and `<prefix>errors`.
	 * Operations against the analytics namespace itself are ignored to
	 * avoid self-measurement feedback.
	 */
	mirrorTo(analytics: TelemetryMirror, options?: {
		prefix?: string;
		ignoreNamespace?: string;
	}): void;
	/**
	 * Attach a provider of cumulative serialized-byte counters (the engines
	 * measure bytes where serialization actually happens).
	 */
	attachByteSource(source: () => {
		bytesRead: number;
		bytesWritten: number;
	}): void;
	/**
	 * Record one completed operation.
	 */
	record(op: TelemetryOp, durationMs: number, opts?: RecordOptions): void;
	/**
	 * Record a failed operation.
	 */
	recordError(op: TelemetryOp | string, error: unknown): void;
	recordExpirations(count: number): void;
	recordEvictions(count: number): void;
	recordTombstones(count: number): void;
	recordCompaction(keysProcessed: number): void;
	recordMigration(fromVersion: number, toVersion: number, rows: number, ms: number): void;
	private recordNamespace;
	private recordWindow;
	snapshot(): TelemetrySnapshot;
	private recordWindowRollOnly;
	reset(): void;
	/**
	 * Export current state in Prometheus / OpenMetrics text format.
	 */
	toPrometheus(prefix?: string): string;
	/**
	 * Export current state as an OTLP/JSON ExportMetricsServiceRequest —
	 * POST it to any OpenTelemetry collector's /v1/metrics endpoint.
	 */
	toOTLP(options?: {
		serviceName?: string;
		attributes?: Record<string, string>;
	}): Record<string, unknown>;
}
/**
 * Defines the configuration options for creating a new KvStore instance.
 */
export interface KvStoreOptions {
	/**
	 * The interval in milliseconds for the store to automatically perform
	 * compaction. Compaction is the process of rewriting the database file to
	 * permanently remove data from expired, deleted, or updated keys.
	 * This saves disk space and speeds up initial load times.
	 *
	 * @remarks
	 * This is a global setting for database maintenance and is different from
	 * the 'ttlSeconds' parameter on the `set` method, which applies a
	 * Time-To-Live expiration to an individual key.
	 *
	 * Set to 0 to disable automatic compaction.
	 * @default 3600000 (1 hour)
	 */
	compactionInterval?: number;
	/**
	 * The default Time-To-Live (TTL) for keys in seconds. If set, each key will
	 * automatically expire after this duration. If not set, keys will persist
	 * until deleted.
	 *
	 * @remarks
	 * This is a per-key setting and overrides the global `compactionInterval`.
	 * If a key-specific TTL is set, it takes precedence over the global setting.
	 *
	 * Set to 0 to disable expiration for a key.
	 * @default 0 (no expiration)
	 */
	ttl?: number;
	/**
	 * Enable soft delete mode. When enabled, deleted entries are marked as deleted
	 * but not physically removed from the database until compaction or manual cleanup.
	 * When disabled, deleted entries are immediately removed from the database.
	 *
	 * @default true
	 */
	softDelete?: boolean;
	/**
	 * Storage configuration.
	 */
	storage?: {
		/**
		 * Storage type
		 * - 'memory': In-memory SQLite database (':memory:')
		 * - 'persistence': File-based SQLite database
		 * @default 'persistence'
		 */
		type?: "memory" | "persistence";
		/**
		 * Maximum number of entries before LRU eviction kicks in
		 * @default 50000 for memory mode, 1000000 for persistence mode
		 */
		maxEntries?: number;
		/**
		 * Maximum memory usage in bytes (only applies to memory mode)
		 * @default 104857600 (100MB)
		 */
		maxMemory?: number;
		/**
		 * LRU eviction interval in milliseconds
		 * @default 60000 (1 minute)
		 */
		evictionInterval?: number;
		/**
		 * Enable LRU eviction when maxItems is reached
		 * @default false
		 */
		eviction?: boolean;
		/**
		 * Persistence storage configuration
		 */
		persistence?: {
			/**
			 * Directory path for storing the persistent database files. If not specified,
			 * defaults to the system's temporary directory (os.tmpdir()). The database
			 * filename will be an MD5 hash of __dirname if dbFileName is not provided.
			 *
			 * @remarks
			 * For production use, it's recommended to specify a custom directory path
			 * to ensure data persistence across system reboots.
			 *
			 * @default os.tmpdir()
			 */
			dbDir?: string;
			/**
			 * Custom database file name (without extension)
			 * @default auto-generated
			 */
			dbFileName?: string;
			/**
			 * SQLite configuration
			 */
			sqlite?: {
				/**
				 * Journal mode for SQLite
				 * @default 'WAL'
				 */
				journalMode?: "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY" | "WAL" | "OFF";
				/**
				 * Synchronous mode for SQLite
				 * @default 'NORMAL'
				 */
				synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
				/**
				 * Cache size in pages (negative value = KB)
				 * @default -10000 (10MB)
				 */
				cacheSize?: number;
				/**
				 * Temporary storage location
				 * @default 'memory'
				 */
				tempStore?: "default" | "file" | "memory";
				/**
				 * Enable foreign key constraints
				 * @default false
				 */
				foreignKeys?: boolean;
				/**
				 * Busy timeout in milliseconds
				 * @default 30000
				 */
				busyTimeout?: number;
			};
			/**
			 * Vacuum configuration
			 */
			vacuum?: {
				/**
				 * Enable vacuum
				 * @default true
				 */
				enabled?: boolean;
				/**
				 * Vacuum mode
				 * @default 'incremental'
				 */
				mode?: "none" | "incremental" | "full";
			};
		};
	};
	/**
	 * Logging configuration
	 */
	logging?: {
		/**
		 * Enable logging
		 * @default false
		 */
		enabled?: boolean;
		/**
		 * Log directory path
		 * @default './logs'
		 */
		logDir?: string;
	};
	/**
	 * Debug mode configuration
	 */
	debug?: {
		/**
		 * Enable debug mode for detailed logging and performance metrics
		 * @default false
		 */
		enabled?: boolean;
		/**
		 * Enable performance timing logs
		 * @default false
		 */
		timing?: boolean;
		/**
		 * Enable SQL query logging
		 * @default false
		 */
		sqlLogging?: boolean;
	};
	/**
	 * Telemetry configuration. Enabled by default with cheap O(1)
	 * recording; pass `false` to disable entirely.
	 */
	telemetry?: TelemetryOptions | false;
	/**
	 * Silence node:sqlite's one-time ExperimentalWarning for this process via
	 * a narrow, delegating process.emitWarning filter (all other warnings pass
	 * through; no listeners are removed). Off by default: a library must not
	 * alter global warning behavior unless the application asks it to.
	 * Node.js only; ignored on Bun.
	 */
	suppressSQLiteWarning?: boolean;
	/**
	 * Keep the Node.js process alive while the store is open.
	 *
	 * When `false` (default), internal timers (compaction, eviction, LRU updates)
	 * are unref'd so they don't prevent the process from exiting naturally.
	 * The store will still work correctly, but the process can exit when there's
	 * no other work to do.
	 *
	 * When `true`, the internal timers will keep the process alive until
	 * `store.close()` is called explicitly.
	 *
	 * @default false
	 */
	keepAlive?: boolean;
}
/**
 * Defines the mapping of event names to their listener function signatures.
 * This ensures full type safety when using `store.on()` or `store.emit()`.
 */
export interface KvStoreEvents<T = unknown> {
	/** Emitted when the store has successfully initialized and is ready for use. */
	ready: () => void;
	/** Emitted when the database is ready for operations. */
	"db:ready": () => void;
	/** Emitted when a new key-value pair is successfully set. */
	set: (key: string, value: T) => void;
	/** Emitted when a key is successfully deleted (either directly or via expiration). */
	delete: (key: string) => void;
	/** Emitted when a key is found to be expired during a `get` or query operation. */
	expire: (key: string) => void;
	/** Emitted when entries are evicted due to LRU or memory limits. */
	evict: (key: string | number) => void;
	/** Emitted when a compaction process is about to begin. */
	"compact:start": () => void;
	/** Emitted when a compaction process has successfully completed. */
	"compact:end": (stats: {
		newSize: number;
		keysProcessed: number;
	}) => void;
	/** Emitted when a recoverable error occurs, such as a corrupted line in the DB file. */
	error: (error: Error) => void;
	/** Emitted when the database file is closed and all resources are cleaned up. */
	close: () => void;
	/** Emitted after an automatic schema migration completes. */
	migrate: (info: {
		fromVersion: number;
		toVersion: number;
		namespaces: number;
		ms: number;
	}) => void;
}
/**
 * Options for key-based operations (get, delete, has)
 */
export interface KeyOptions {
	/**
	 * Namespace to scope the operation to
	 * @default '_default'
	 */
	namespace?: string;
}
/**
 * Options for set operations
 */
export interface SetOptions extends KeyOptions {
	/**
	 * Time-to-live in seconds. After this duration, the key will expire.
	 * Set to 0 or undefined for no expiration.
	 */
	ttl?: number;
}
/**
 * Options for listing and querying operations
 */
export interface ListOptions extends KeyOptions {
	/**
	 * Filter keys that start with this prefix
	 */
	prefix?: string;
	/**
	 * Filter keys that end with this suffix
	 */
	suffix?: string;
	/**
	 * Maximum number of results to return
	 * @default 100
	 */
	limit?: number;
	/**
	 * Number of results to skip (for pagination)
	 * @default 0
	 */
	offset?: number;
	/**
	 * 1-based page number; alternative to `offset` (page size is `limit`,
	 * default 100). When both are provided, `offset` wins.
	 */
	page?: number;
	/**
	 * Keyset cursor: only keys strictly greater than this are returned.
	 * Stable under concurrent writes, unlike offset pagination.
	 */
	after?: string;
}
/**
 * Options for key/value search
 */
export interface SearchOptions extends ListOptions {
	/**
	 * Also match the pattern against serialized values (slower)
	 */
	searchValues?: boolean;
	/**
	 * Case-insensitive matching when the pattern is a string
	 */
	caseInsensitive?: boolean;
}
/**
 * TTL information for a key
 */
export interface TTLInfo {
	/**
	 * Remaining TTL in seconds (rounded up)
	 */
	remaining: number;
	/**
	 * Absolute expiry timestamp (ms)
	 */
	expiresAt: number;
}
/**
 * Options for size/count operations
 */
export interface SizeOptions extends KeyOptions {
	/**
	 * Filter keys that start with this prefix
	 */
	prefix?: string;
	/**
	 * Filter keys that end with this suffix
	 */
	suffix?: string;
}
/**
 * Entry type for bulk set operations
 */
export interface BulkSetEntry<T = unknown> {
	key: string;
	value: T;
	ttl?: number;
}
/**
 * Statistics for a single namespace
 */
export interface NamespaceStats {
	/**
	 * Namespace name
	 */
	namespace: string;
	/**
	 * Count of active (non-deleted, non-expired) entries
	 */
	activeCount: number;
	/**
	 * Count of soft-deleted entries
	 */
	deletedCount: number;
	/**
	 * Count of expired entries (not yet cleaned up)
	 */
	expiredCount: number;
	/**
	 * Total size in bytes (approximate)
	 */
	sizeBytes: number;
}
/**
 * Global store statistics
 */
export interface StoreStats {
	/**
	 * Statistics per namespace
	 */
	namespaces: NamespaceStats[];
	/**
	 * Total active entries across all namespaces
	 */
	totalActive: number;
	/**
	 * Total deleted entries across all namespaces
	 */
	totalDeleted: number;
	/**
	 * Total expired entries across all namespaces
	 */
	totalExpired: number;
	/**
	 * Total size in bytes across all namespaces
	 */
	totalSizeBytes: number;
}
/**
 * Size type for getSize operations
 */
export type SizeType = "active" | "deleted" | "expired" | "all";
/**
 * Batch operation types
 */
export interface PutBatchOperation<T = unknown> {
	type: "put";
	key: string;
	value: T;
	ttl?: number;
	namespace?: string;
}
export interface DelBatchOperation {
	type: "del";
	key: string;
	namespace?: string;
}
export type BatchOperation<T = unknown> = PutBatchOperation<T> | DelBatchOperation;
/**
 * Storage entry returned from storage manager
 */
export interface StorageEntry<T = unknown> {
	key: string;
	namespace: string;
	value: T;
	createdAt: number;
	expiresAt?: number;
	isDeleted: boolean;
	lastAccessed: number;
}
/**
 * Namespaced store interface - provides a namespace-scoped view of the store
 */
export interface INamespacedStore {
	/**
	 * The namespace name
	 */
	readonly name: string;
	/**
	 * Store a value
	 */
	set<T>(key: string, value: T, ttl?: number): Promise<void>;
	/**
	 * Retrieve a value
	 */
	get<T>(key: string): Promise<T | null>;
	/**
	 * Delete a key
	 */
	delete(key: string): Promise<boolean>;
	/**
	 * Check if a key exists
	 */
	has(key: string): Promise<boolean>;
	/**
	 * Get multiple values at once
	 */
	getMany<T>(keys: string[]): Promise<Map<string, T>>;
	/**
	 * Set multiple values at once
	 */
	setMany<T>(entries: BulkSetEntry<T>[]): Promise<void>;
	/**
	 * Delete multiple keys at once
	 */
	deleteMany(keys: string[]): Promise<number>;
	/**
	 * List all keys in this namespace
	 */
	listKeys(options?: Omit<ListOptions, "namespace">): Promise<string[]>;
	/**
	 * List all key-value pairs in this namespace
	 */
	list<T>(options?: Omit<ListOptions, "namespace">): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * List entries with storage metadata (createdAt, expiresAt, lastAccessed)
	 */
	inspect(options?: Omit<ListOptions, "namespace">): Promise<StorageEntry[]>;
	/**
	 * List all values in this namespace
	 */
	values<T>(options?: Omit<ListOptions, "namespace">): Promise<T[]>;
	/**
	 * Alias of list(): all entries as key-value pairs
	 */
	entries<T>(options?: Omit<ListOptions, "namespace">): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * Search entries by key pattern (optionally in values)
	 */
	search<T>(pattern: string | RegExp, options?: Omit<SearchOptions, "namespace">): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * Get TTL info for a key; null when absent or without TTL
	 */
	ttl(key: string): Promise<TTLInfo | null>;
	/**
	 * Set the TTL of an existing key (ttlSeconds <= 0 removes it)
	 */
	expire(key: string, ttlSeconds: number): Promise<boolean>;
	/**
	 * Remove the TTL from a key
	 */
	persist(key: string): Promise<boolean>;
	/**
	 * Get the count of entries
	 */
	getSize(type?: SizeType): Promise<number>;
	/**
	 * Clear all entries in this namespace
	 */
	clear(): Promise<number>;
	/**
	 * Get statistics for this namespace
	 */
	getStats(): Promise<NamespaceStats>;
}
/**
 * Performance metrics for monitoring
 */
export interface StorageMetrics {
	operations: {
		get: {
			count: number;
			totalMs: number;
		};
		set: {
			count: number;
			totalMs: number;
		};
		delete: {
			count: number;
			totalMs: number;
		};
		has: {
			count: number;
			totalMs: number;
		};
	};
	cache: {
		hits: number;
		misses: number;
	};
	errors: {
		count: number;
		lastError?: Error;
	};
}
/**
 * Schema validation result
 */
export interface SchemaValidationResult {
	isValid: boolean;
	currentVersion?: number;
	expectedVersion: number;
	missingColumns: string[];
	extraColumns: string[];
	message?: string;
}
/**
 * Raw SQL access for the SQLite stores (`store.raw`).
 *
 * The full bun:sqlite API, async-only, identical on every runtime:
 * on Bun calls route directly to bun:sqlite; on Node a thin adapter gives
 * node:sqlite the same shape (`raw.engine` says which driver is under you).
 *
 * Database surface: query (cached) / prepare / run / exec / transaction
 * (factory with .deferred/.immediate/.exclusive and savepoint nesting) /
 * serialize / checkpoint / filename / inTransaction — plus the hydda
 * extra `tables()`. Connection lifetime belongs to the store
 * (`store.close()`), so raw has no close().
 *
 * Statement surface: all / get / run / values / iterate (async iterator) /
 * as(Class) / safeIntegers / columnNames / paramsCount / finalize /
 * toString.
 *
 * Guardrails (one linear pass per SQL string, zero per-row cost):
 * - connection/database state is store-owned: PRAGMA, ATTACH/DETACH, bare
 *   VACUUM, and manual transaction keywords are blocked, each with a
 *   sanctioned door (pragma(), checkpoint(), transaction(), serialize())
 * - hydda-internal tables (`kv_store`, `hydda_ns_*`, `hydda_namespaces`,
 *   `hydda_meta`) cannot be read, written, or dropped through raw
 * - catalog queries (sqlite_master / PRAGMA table_list ...) silently omit
 *   internal tables from their results
 * - the bare Database/statement handles (bun's db.handle /
 *   statement.native) are not part of this API at all — they would
 *   bypass every guard above
 */
/** Typed-array values accepted as bind parameters */
export type RawTypedArray = Uint8Array | Uint8ClampedArray | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array | Float16Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;
/**
 * Bind parameters — structurally identical to bun:sqlite's
 * SQLQueryBindings (asserted at compile time in raw-typecheck.ts, defined
 * locally so the published types don't require bun-types): positional
 * values and named-parameter objects (`{ $name: value }`, portable across
 * bun and node when keys are $-prefixed).
 */
export type RawParam = string | number | bigint | boolean | null | RawTypedArray | Record<string, string | number | bigint | boolean | null | RawTypedArray>;
/**
 * Result of a raw write statement — structurally identical to bun:sqlite's
 * Changes (asserted at compile time in raw-typecheck.ts)
 */
export interface RawRunResult {
	changes: number;
	lastInsertRowid: number | bigint;
}
/**
 * Async statement with bun:sqlite semantics and generics on every runtime
 * — mirrors bun's `Statement<ReturnType, ParamsType>`.
 */
export interface RawStatement<T = Record<string, unknown>, P extends RawParam[] = RawParam[]> {
	/** All matching rows */
	all(...params: P): Promise<T[]>;
	/** First row, or null when nothing matches (bun semantics) */
	get(...params: P): Promise<T | null>;
	/** Execute for side effects */
	run(...params: P): Promise<RawRunResult>;
	/** Rows as positional arrays instead of objects */
	values(...params: P): Promise<unknown[][]>;
	/** Stream rows one at a time (async translation of bun's iterate()) */
	iterate(...params: P): AsyncIterableIterator<T>;
	/** Map rows onto a class prototype — bun's Statement.as() */
	as<C>(Class: new (...args: never[]) => C): RawStatement<C, P>;
	/** Return integers as bigint (node: setReadBigInts) */
	safeIntegers(enabled?: boolean): RawStatement<T, P>;
	/** Column names (best effort before first execution on node) */
	readonly columnNames: string[];
	/** Number of bound parameters (best effort on node) */
	readonly paramsCount: number;
	/** Release the statement (no-op where the driver has no finalize) */
	finalize(): Promise<void>;
	/** The SQL this statement was prepared from */
	toString(): string;
}
/** Async transaction function returned by raw.transaction() */
export interface RawTransaction<A extends unknown[], R> {
	(...args: A): Promise<R>;
	/** BEGIN DEFERRED variant */
	deferred(...args: A): Promise<R>;
	/** BEGIN IMMEDIATE variant */
	immediate(...args: A): Promise<R>;
	/** BEGIN EXCLUSIVE variant */
	exclusive(...args: A): Promise<R>;
}
/**
 * Unified raw access surface — the bun:sqlite API, async-only.
 */
export interface RawAccess {
	/** Driver underneath: routed directly on bun, adapted on node */
	readonly engine: "bun" | "node";
	/** Database file path (':memory:' for in-memory stores) */
	readonly filename: string;
	/** Whether a raw transaction (or savepoint) is currently open */
	readonly inTransaction: boolean;
	/** Prepare (and cache) a statement — bun's `db.query<ReturnType, ParamsType>()` */
	query<T = Record<string, unknown>, P extends RawParam[] = RawParam[]>(sql: string): RawStatement<T, P>;
	/** Prepare a fresh, uncached statement — bun's `db.prepare<ReturnType, ParamsType>()` */
	prepare<T = Record<string, unknown>, P extends RawParam[] = RawParam[]>(sql: string): RawStatement<T, P>;
	/** One-shot write — bun's `db.run()` */
	run(sql: string, ...params: RawParam[]): Promise<RawRunResult>;
	/**
	 * bun's `db.exec()` (alias of run). Without parameters, multi-statement
	 * scripts are supported; the result reports zero changes for scripts.
	 */
	exec(sql: string, ...params: RawParam[]): Promise<RawRunResult>;
	/**
	 * bun's `db.transaction()` — returns an async function that runs `fn`
	 * inside BEGIN/COMMIT (ROLLBACK on throw). Nested calls become
	 * savepoints. Variants: `.deferred` / `.immediate` / `.exclusive`.
	 */
	transaction<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>): RawTransaction<A, R>;
	/**
	 * bun's `db.serialize()` — a byte-for-byte snapshot of the database
	 * (emulated with VACUUM INTO on node). Note: this is a whole-file
	 * backup and therefore includes hydda's own tables.
	 */
	serialize(): Promise<Uint8Array>;
	/**
	 * Read a diagnostic PRAGMA (value-less form only): journal_mode,
	 * page_count, integrity_check, freelist_count, table_info(...) is NOT
	 * accepted here — pass a bare pragma name. Assignment PRAGMAs are
	 * never available through raw: connection settings belong to the store.
	 */
	pragma<T = Record<string, unknown>>(name: string): Promise<T[]>;
	/**
	 * Flush the WAL back into the main database file.
	 * @param mode SQLite checkpoint mode (default 'PASSIVE')
	 */
	checkpoint(mode?: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE"): Promise<void>;
	/** hydda extra: user tables only (internal tables omitted) */
	tables(): Promise<string[]>;
}
/**
 * Migration options
 */
export interface MigrationOptions {
	/**
	 * Path to the database file
	 */
	dbPath: string;
	/**
	 * Create a backup before migration
	 * @default true
	 */
	backup?: boolean;
	/**
	 * Dry run - only check what would be migrated without making changes
	 * @default false
	 */
	dryRun?: boolean;
	/**
	 * Verbose logging
	 * @default false
	 */
	verbose?: boolean;
}
/**
 * Migration result
 */
export interface MigrationResult {
	success: boolean;
	fromVersion: number | null;
	toVersion: number;
	changes: string[];
	backupPath?: string;
	error?: string;
}
/**
 * Schema check result
 */
export interface SchemaCheckResult {
	needsMigration: boolean;
	validation: SchemaValidationResult;
	dbPath: string;
	exists: boolean;
}
declare class Hydda {
	private readonly options;
	private readonly emitter;
	private readonly engine;
	private readonly tel;
	private readonly namespaceCache;
	private compactionTimer?;
	private evictionTimer?;
	private isCompacting;
	private isClosing;
	private dbName;
	private constructor();
	/**
	 * Creates and initializes a new Hydda instance.
	 *
	 * @param options - Configuration options for the store
	 * @returns Promise that resolves to an initialized Hydda instance
	 */
	static create(options?: KvStoreOptions): Promise<Hydda>;
	private initialize;
	on<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	off<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	addEventListener<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	removeEventListener<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	/**
	 * Checks if a key exists in the store and is not expired.
	 *
	 * @param key - The key to check for existence
	 * @param options - Optional namespace options
	 * @returns Promise that resolves to true if the key exists and is valid
	 */
	has(key: string, options?: KeyOptions): Promise<boolean>;
	/**
	 * Retrieves a value from the store by its key.
	 *
	 * @template T - The expected type of the stored value
	 * @param key - The key to retrieve the value for
	 * @param options - Optional namespace options
	 * @returns Promise that resolves to the stored value or null if not found/expired
	 *
	 * @example
	 * ```typescript
	 * const user = await store.get<User>('user:123');
	 * const user = await store.get<User>('john', { namespace: 'users' });
	 * ```
	 */
	get<T>(key: string, options?: KeyOptions): Promise<T | null>;
	/**
	 * Stores a value in the store with optional TTL and namespace.
	 *
	 * @template T - The type of the value being stored
	 * @param key - The key to store the value under
	 * @param value - The value to store
	 * @param ttlOrOptions - TTL in seconds (backward compatible) or SetOptions object
	 *
	 * @example
	 * ```typescript
	 * // Backward compatible
	 * await store.set('key', value);
	 * await store.set('key', value, 60); // TTL 60 seconds
	 *
	 * // New options API
	 * await store.set('key', value, { ttl: 60 });
	 * await store.set('key', value, { namespace: 'users' });
	 * await store.set('key', value, { ttl: 60, namespace: 'users' });
	 * ```
	 */
	set<T>(key: string, value: T, ttlOrOptions?: number | SetOptions): Promise<void>;
	/**
	 * Deletes a key from the store.
	 *
	 * @param key - The key to delete
	 * @param options - Optional namespace options
	 * @returns Promise that resolves to true if the key was deleted
	 */
	delete(key: string, options?: KeyOptions): Promise<boolean>;
	/**
	 * Get multiple values at once (10-100x faster than individual gets)
	 *
	 * @example
	 * ```typescript
	 * const values = await store.getMany(['key1', 'key2', 'key3']);
	 * const values = await store.getMany(['key1', 'key2'], { namespace: 'users' });
	 * ```
	 */
	getMany<T>(keys: string[], options?: KeyOptions): Promise<Map<string, T>>;
	/**
	 * Set multiple values at once (uses transaction, much faster)
	 *
	 * @example
	 * ```typescript
	 * await store.setMany([
	 *   { key: 'user1', value: { name: 'John' } },
	 *   { key: 'user2', value: { name: 'Jane' }, ttl: 3600 }
	 * ]);
	 * ```
	 */
	setMany<T>(entries: BulkSetEntry<T>[], options?: KeyOptions): Promise<void>;
	/**
	 * Delete multiple keys at once
	 *
	 * @example
	 * ```typescript
	 * const count = await store.deleteMany(['key1', 'key2', 'key3']);
	 * ```
	 */
	deleteMany(keys: string[], options?: KeyOptions): Promise<number>;
	getSize(): Promise<number>;
	getSize(type: SizeType): Promise<number>;
	getSize(options: SizeOptions): Promise<number>;
	getSize(type: SizeType, options: SizeOptions): Promise<number>;
	/**
	 * Translate the 1-based `page` option to `offset` (page size = `limit`,
	 * default 100). An explicit `offset` wins.
	 */
	private resolveListOptions;
	listKeys(): Promise<string[]>;
	listKeys(options: ListOptions): Promise<string[]>;
	/**
	 * List key-value pairs matching criteria
	 */
	list<T>(options?: ListOptions): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * List entries with storage metadata (createdAt, expiresAt,
	 * lastAccessed) — the raw material for data analysis.
	 */
	inspect(options?: ListOptions): Promise<StorageEntry[]>;
	/**
	 * List all values matching criteria
	 */
	values<T>(options?: ListOptions): Promise<T[]>;
	/**
	 * Alias of list(): all entries as key-value pairs
	 */
	entries<T>(options?: ListOptions): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * Iterate over entries (memory efficient for large datasets).
	 * `options.limit` caps the total number of entries visited; return
	 * `false` from the callback to stop early.
	 */
	forEach<T>(callback: (key: string, value: T) => void | boolean | Promise<void | boolean>, options?: ListOptions): Promise<void>;
	/**
	 * Search entries by key pattern (string or RegExp). With
	 * `searchValues: true` the pattern is also matched against the
	 * JSON-serialized value.
	 */
	search<T>(pattern: string | RegExp, options?: SearchOptions): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * Get TTL info for a key; null when the key is absent or has no TTL.
	 */
	ttl(key: string, options?: KeyOptions): Promise<TTLInfo | null>;
	/**
	 * Set the TTL of an existing key. `ttlSeconds <= 0` removes the TTL.
	 * Returns false when the key doesn't exist (or is deleted/expired).
	 */
	expire(key: string, ttlSeconds: number, options?: KeyOptions): Promise<boolean>;
	/**
	 * Remove the TTL from a key (make it persistent).
	 */
	persist(key: string, options?: KeyOptions): Promise<boolean>;
	/**
	 * Get a namespace-scoped store (recommended for repeated namespace operations)
	 *
	 * @example
	 * ```typescript
	 * const users = store.ns('users');
	 * await users.set('john', { name: 'John' });
	 * const john = await users.get('john');
	 * await users.delete('john');
	 * ```
	 */
	ns(namespace: string): INamespacedStore;
	/**
	 * Alias for ns()
	 */
	namespace(namespace: string): INamespacedStore;
	/**
	 * List all namespaces with active entries
	 */
	listNamespaces(): Promise<string[]>;
	/**
	 * Clear all entries in a namespace
	 */
	clearNamespace(namespace: string): Promise<number>;
	/**
	 * Get statistics for a namespace
	 */
	getNamespaceStats(namespace: string): Promise<NamespaceStats>;
	/**
	 * Get global store statistics
	 */
	getStats(): Promise<StoreStats>;
	/**
	 * Get performance metrics
	 */
	getMetrics(): StorageMetrics;
	/**
	 * Rich telemetry snapshot: latency percentiles per operation, cache hit
	 * rate, per-namespace activity, lifecycle counters, slow ops, errors,
	 * and a rolling 60s throughput window.
	 */
	getTelemetry(): TelemetrySnapshot;
	/**
	 * The live Telemetry instance (reset, enable/disable, toPrometheus).
	 */
	get telemetry(): Telemetry;
	/**
	 * Reset performance metrics
	 */
	resetMetrics(): void;
	clearSoftDeletedEntries(): Promise<number>;
	clearExpiredEntries(): Promise<number>;
	clear(): Promise<void>;
	compact(): Promise<void>;
	private runEviction;
	/**
	 * Execute batch operations atomically
	 */
	batch(operations: BatchOperation[]): Promise<void>;
	/**
	 * Create a transaction for batch operations
	 */
	createTransaction(): {
		put<T>(key: string, value: T, ttlSeconds?: number, namespace?: string): void;
		del(key: string, namespace?: string): void;
		commit(): Promise<void>;
		rollback(): void;
	};
	close(): Promise<void>;
	/**
	 * Get the database file path
	 */
	getDbFilePath(): string;
	/**
	 * Guarded raw SQL access — one async, bun:sqlite-flavored API on every
	 * runtime. On Bun calls route directly to bun:sqlite; on Node a thin
	 * adapter gives node:sqlite the same shape (`raw.engine` tells which).
	 * hydda-internal tables are unreachable, and catalog queries omit them.
	 *
	 * @example
	 * ```typescript
	 * const raw = store.raw;
	 * await raw.exec('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, msg TEXT)');
	 * await raw.run('INSERT INTO logs (msg) VALUES (?)', 'hello');
	 *
	 * const logs = raw.query('SELECT * FROM logs WHERE id > ?');  // cached stmt
	 * const rows = await logs.all(0);
	 * const one  = await logs.get(0);        // null when no row (bun semantics)
	 * ```
	 */
	get raw(): RawAccess;
	/**
	 * Check if a database needs schema migration.
	 *
	 * @param dbPath - Path to the database file
	 * @returns Promise resolving to schema check result
	 *
	 * @example
	 * ```typescript
	 * const result = await Hydda.checkSchema('/path/to/store.yqs');
	 * if (result.needsMigration) {
	 *   console.log('Migration needed:', result.validation.missingColumns);
	 * }
	 * ```
	 */
	static checkSchema(dbPath: string): Promise<SchemaCheckResult>;
	/**
	 * Migrate a database to the latest schema version.
	 *
	 * @param options - Migration options
	 * @returns Promise resolving to migration result
	 *
	 * @example
	 * ```typescript
	 * // Basic migration with backup
	 * const result = await Hydda.migrate({
	 *   dbPath: '/path/to/store.yqs',
	 *   backup: true,
	 *   verbose: true
	 * });
	 *
	 * if (result.success) {
	 *   console.log('Migrated from v' + result.fromVersion + ' to v' + result.toVersion);
	 * }
	 *
	 * // Dry run to preview changes
	 * const preview = await Hydda.migrate({
	 *   dbPath: '/path/to/store.yqs',
	 *   dryRun: true
	 * });
	 * console.log('Would make changes:', preview.changes);
	 * ```
	 */
	static migrate(options: MigrationOptions): Promise<MigrationResult>;
	/**
	 * Find all hydda database files in a directory.
	 *
	 * @param dir - Directory to search
	 * @param pattern - Glob pattern (default: '*.yqs')
	 * @returns Array of database file paths
	 *
	 * @example
	 * ```typescript
	 * const databases = Hydda.findDatabases('/data/stores');
	 * for (const dbPath of databases) {
	 *   const check = await Hydda.checkSchema(dbPath);
	 *   if (check.needsMigration) {
	 *     await Hydda.migrate({ dbPath, backup: true });
	 *   }
	 * }
	 * ```
	 */
	static findDatabases(dir: string, pattern?: string): string[];
}
/** Minimal store surface analytics needs — satisfied by every hydda store */
export interface AnalyticsBackend {
	set<T>(key: string, value: T, options?: {
		ttl?: number;
		namespace?: string;
	}): Promise<void>;
	get<T>(key: string, options?: {
		namespace?: string;
	}): Promise<T | null>;
	getMany<T>(keys: string[], options?: {
		namespace?: string;
	}): Promise<Map<string, T>>;
	setMany<T>(entries: Array<{
		key: string;
		value: T;
		ttl?: number;
	}>, options?: {
		namespace?: string;
	}): Promise<void>;
	delete(key: string, options?: {
		namespace?: string;
	}): Promise<boolean>;
	listKeys(options?: {
		namespace?: string;
		prefix?: string;
		limit?: number;
		offset?: number;
	}): Promise<string[]>;
	list<T>(options?: {
		namespace?: string;
		prefix?: string;
		limit?: number;
		offset?: number;
	}): Promise<Array<{
		key: string;
		value: T;
	}>>;
	getSize(type: "active" | "deleted" | "expired" | "all", options: {
		namespace?: string;
		prefix?: string;
	}): Promise<number>;
	/** Entries with storage metadata (used by analyzeNamespace) */
	inspect?(options?: {
		namespace?: string;
		limit?: number;
		offset?: number;
	}): Promise<Array<{
		key: string;
		createdAt: number;
		expiresAt?: number;
		lastAccessed: number;
	}>>;
	getNamespaceStats?(namespace: string): Promise<{
		activeCount: number;
		deletedCount: number;
		expiredCount: number;
		sizeBytes: number;
	}>;
}
export type AnalyticsRange = "1h" | "24h" | "7d" | "30d" | "90d" | "365d" | "hour" | "today" | "yesterday" | "week" | "month" | "quarter" | "year" | "all" | {
	from: number;
	to?: number;
} | {
	days: number;
} | {
	hours: number;
};
export interface AnalyticsOptions {
	/**
	 * Namespace holding analytics data.
	 * @default '_analytics'
	 */
	namespace?: string;
	/**
	 * How long hourly buckets are retained (seconds). Daily buckets and
	 * lifetime totals are kept forever.
	 * @default 7776000 (90 days)
	 */
	hourlyRetention?: number;
	/**
	 * Default retention for tracked events (seconds). 0 = keep forever.
	 * @default 0
	 */
	eventRetention?: number;
	/**
	 * Flush buffered writes every N milliseconds.
	 * @default 1000
	 */
	flushInterval?: number;
	/**
	 * Flush when this many buffered records accumulate.
	 * @default 500
	 */
	maxBuffer?: number;
	/**
	 * Minute offset applied before day bucketing, so "today" matches the
	 * app's timezone instead of UTC (e.g. -300 for UTC-5, 120 for UTC+2).
	 * @default 0
	 */
	utcOffsetMinutes?: number;
	/**
	 * Retention for per-day active-user markers (seconds).
	 * @default 34560000 (400 days)
	 */
	activeRetention?: number;
	/**
	 * Max distinct values tracked per (metric, dimension) pair. Values past
	 * the cap still count into the base metric but get no dimension series
	 * (protects against accidental unbounded cardinality like userId
	 * dimensions). Drops are reported by health().
	 * @default 1000
	 */
	dimensionCardinalityLimit?: number;
}
/** Buffer and flush health, for monitoring the analytics pipeline itself */
export interface AnalyticsHealth {
	buffered: {
		counters: number;
		values: number;
		writes: number;
	};
	/** Dimension values dropped by dimensionCardinalityLimit */
	droppedDimensionValues: number;
	flushes: number;
	lastFlushAt: number;
	lastFlushError?: string;
}
export interface IncrementOptions {
	/** Dimension values to attribute this count to (e.g. { campaign: 'x' }) */
	dimensions?: Record<string, string>;
	/** Event time (ms). Defaults to now. */
	at?: number;
}
export interface SeriesPoint {
	/** Bucket start timestamp (ms) */
	t: number;
	value: number;
}
export interface SeriesResult {
	metric: string;
	interval: "hour" | "day" | "week" | "month";
	points: SeriesPoint[];
	total: number;
	peak: number;
	peakAt: number;
	avg: number;
}
export interface RateResult {
	/** numerator / denominator, 0..1 (0 when denominator is 0) */
	rate: number;
	/** rate as a percentage rounded to one decimal, e.g. 33.3 */
	percent: number;
	numerator: number;
	denominator: number;
}
export interface BreakdownEntry {
	value: string;
	count: number;
	/** share of the breakdown total, 0..1 */
	share: number;
}
export interface CompareResult {
	current: number;
	previous: number;
	change: number;
	/** percentage change vs previous period; null when previous is 0 */
	changePct: number | null;
}
export interface SummaryResult {
	metric: string;
	total: number;
	/** First time this metric was recorded (ms), 0 if never */
	since: number;
	lastAt: number;
}
export interface AnalyticsEvent<T = Record<string, unknown>> {
	stream: string;
	at: number;
	data: T;
}
export interface GaugeValue {
	value: number;
	at: number;
}
/** Aggregate statistics for a recorded value distribution */
export interface StatsResult {
	metric: string;
	count: number;
	sum: number;
	avg: number;
	min: number;
	max: number;
}
/** One step of a funnel */
export interface FunnelStep {
	metric: string;
	count: number;
	/** Conversion vs the first step, 0..1 */
	conversion: number;
	/** Conversion vs the previous step, 0..1 */
	stepConversion: number;
}
/** Health/growth analysis of a real data namespace */
export interface NamespaceAnalysis {
	namespace: string;
	activeCount: number;
	deletedCount: number;
	expiredCount: number;
	sizeBytes: number;
	/** Entries created per day over the analyzed window (zero-filled) */
	createdSeries: SeriesPoint[];
	createdToday: number;
	createdThisWeek: number;
	oldestAt: number;
	newestAt: number;
	/** Share of entries carrying a TTL, 0..1 */
	ttlCoverage: number;
	/** Entries expiring within the next 24h */
	expiringNext24h: number;
	/** Most recent lastAccessed across entries */
	lastActivityAt: number;
}
export declare class Analytics {
	private readonly store;
	private readonly ns;
	private readonly options;
	/** Buffered counter deltas: storage key -> delta */
	private counterBuffer;
	/** Keys carrying TTL when written (hourly buckets) */
	private counterTtls;
	/** Buffered value-distribution merges: storage key -> bucket */
	private valueBuffer;
	private valueTtls;
	/** Buffered events / gauges / uniques */
	private writeBuffer;
	/** Series ids whose first-seen marker may be missing */
	private pendingFirstSeen;
	private knownFirstSeen;
	private flushTimer?;
	private eventSeq;
	private closed;
	private flushing;
	/** Cardinality tracking: metric|dim -> seen values */
	private dimValues;
	private droppedDimensionValues;
	private flushes;
	private lastFlushAt;
	private lastFlushError?;
	constructor(store: AnalyticsBackend | Hydda, options?: AnalyticsOptions);
	private hourBucket;
	private dayBucket;
	private dayBucketStartMs;
	private get offsetMs();
	/** Start of the local calendar day containing `at` */
	private startOfDay;
	/** Start of the local ISO week (Monday) containing `at` */
	private startOfWeek;
	/** Start of the local calendar month containing `at` */
	private startOfMonth;
	/** Start of the local calendar quarter containing `at` */
	private startOfQuarter;
	/** Start of the local calendar year containing `at` */
	private startOfYear;
	/** Namespace holding analytics data (used by Telemetry.mirrorTo) */
	get namespace(): string;
	/**
	 * Increment a counter. Writes are buffered; hourly + daily buckets and
	 * the lifetime total are maintained per series (base metric and each
	 * single dimension).
	 */
	increment(metric: string, count?: number, options?: IncrementOptions): void;
	/** Decrement a counter (sugar for negative increments). */
	decrement(metric: string, count?: number, options?: IncrementOptions): void;
	/** Cardinality guard; false = drop the dimension series (base still counts) */
	private admitDimensionValue;
	/** Pipeline health: buffer depths, drops, flush status. */
	health(): AnalyticsHealth;
	private bufferCounter;
	/**
	 * Record an event on a stream (activity feeds, run history).
	 * Newest-first reads come from `recent()`.
	 */
	track<T extends Record<string, unknown>>(stream: string, data: T, options?: {
		at?: number;
		retention?: number;
	}): void;
	/** Set a gauge to a current value (account health, queue depth, ...). */
	gauge(name: string, value: number, options?: {
		dimensions?: Record<string, string>;
		at?: number;
	}): void;
	/** Add a member to a distinct set (unique contacts, unique senders...). */
	addUnique(set: string, member: string): void;
	private maybeAutoFlush;
	/**
	 * Persist all buffered writes in bulk. Called automatically on the
	 * flush interval, on buffer pressure, and on close().
	 */
	flush(): Promise<void>;
	private withFlushLock;
	private flushWithRetry;
	private flushNow;
	/** Flush and stop the interval. The instance rejects further writes. */
	close(): Promise<void>;
	private resolveRange;
	/**
	 * Total for a metric over a range ('all' = lifetime total).
	 */
	count(metric: string, options?: {
		range?: AnalyticsRange;
		dimensions?: Record<string, string>;
	}): Promise<number>;
	/**
	 * Zero-filled time series for charting (the "send velocity" widget).
	 * Interval defaults to 'hour' for ranges ≤ 48h, otherwise 'day'.
	 */
	series(metric: string, options?: {
		range?: AnalyticsRange;
		interval?: "hour" | "day" | "week" | "month";
		dimensions?: Record<string, string>;
	}): Promise<SeriesResult>;
	/**
	 * Ratio of two counters (the "delivery rate" widget).
	 */
	rate(numeratorMetric: string, denominatorMetric: string, options?: {
		range?: AnalyticsRange;
		dimensions?: Record<string, string>;
	}): Promise<RateResult>;
	/**
	 * Totals per value of one dimension, largest first (the "volume by
	 * campaign" widget).
	 */
	breakdown(metric: string, dimension: string, options?: {
		range?: AnalyticsRange;
		top?: number;
	}): Promise<BreakdownEntry[]>;
	private list_;
	/**
	 * Current vs previous period (the "0 sent today · 0 yesterday" widget).
	 * Periods: 'today' compares with yesterday, 'hour' with the previous
	 * hour, '7d'/'30d' with the preceding 7/30 days.
	 */
	compare(metric: string, period: "hour" | "today" | "week" | "month" | "year" | "7d" | "30d", options?: {
		dimensions?: Record<string, string>;
	}): Promise<CompareResult>;
	/**
	 * Newest-first events from a stream (the "recent activity" widget).
	 */
	recent<T = Record<string, unknown>>(stream: string, options?: {
		limit?: number;
		offset?: number;
	}): Promise<Array<AnalyticsEvent<T>>>;
	/** Read a gauge. */
	getGauge(name: string, options?: {
		dimensions?: Record<string, string>;
	}): Promise<GaugeValue | null>;
	/** Distinct members recorded in a set. */
	distinctCount(set: string): Promise<number>;
	/** Whether a member is already in a distinct set. */
	hasUnique(set: string, member: string): Promise<boolean>;
	/**
	 * Lifetime total plus first/last activity (the "13 delivered · since
	 * Jun 23" header).
	 */
	summary(metric: string, options?: {
		dimensions?: Record<string, string>;
	}): Promise<SummaryResult>;
	/**
	 * Record a numeric observation — sum/avg/min/max become queryable via
	 * stats() and statsSeries().
	 */
	record(metric: string, value: number, options?: IncrementOptions): void;
	private bufferValue;
	/** Sugar for recording a duration in milliseconds. */
	time(metric: string, ms: number, options?: IncrementOptions): void;
	/**
	 * Start a timer; the returned function records the elapsed milliseconds
	 * and returns them.
	 */
	startTimer(metric: string, options?: IncrementOptions): () => number;
	/**
	 * Aggregate statistics for a recorded metric over a range.
	 */
	stats(metric: string, options?: {
		range?: AnalyticsRange;
		dimensions?: Record<string, string>;
	}): Promise<StatsResult>;
	/**
	 * Time series of a distribution statistic (avg response time per day,
	 * revenue sum per week, ...). Zero-filled like series().
	 */
	statsSeries(metric: string, options?: {
		range?: AnalyticsRange;
		interval?: "hour" | "day" | "week" | "month";
		stat?: "avg" | "sum" | "count" | "min" | "max";
		dimensions?: Record<string, string>;
	}): Promise<SeriesResult>;
	/**
	 * Mark a member active for the day (call on any user/entity activity).
	 */
	trackActive(set: string, member: string, options?: {
		at?: number;
	}): void;
	/**
	 * Distinct active members over a range — DAU ('today'), WAU ('7d' or
	 * 'week'), MAU ('30d' or 'month').
	 */
	activeCount(set: string, options?: {
		range?: AnalyticsRange;
	}): Promise<number>;
	/**
	 * Daily active count per day over a range (the DAU chart).
	 */
	activeSeries(set: string, options?: {
		range?: AnalyticsRange;
	}): Promise<SeriesResult>;
	/**
	 * Conversion funnel across ordered step metrics.
	 */
	funnel(steps: string[], options?: {
		range?: AnalyticsRange;
		dimensions?: Record<string, string>;
	}): Promise<FunnelStep[]>;
	/**
	 * Top values of a dimension, largest first (leaderboards, top search
	 * terms, top campaigns). Alias of breakdown().
	 */
	top(metric: string, dimension: string, options?: {
		range?: AnalyticsRange;
		limit?: number;
	}): Promise<BreakdownEntry[]>;
	/**
	 * Delete every stored bucket, total, and distribution for a metric
	 * (including all dimension variants).
	 */
	resetMetric(metric: string): Promise<number>;
	/**
	 * Analyze a real data namespace using entry metadata: growth per day,
	 * TTL coverage, upcoming expirations, staleness. Requires a store with
	 * inspect() (every hydda store has it).
	 */
	analyzeNamespace(namespace: string, options?: {
		days?: number;
	}): Promise<NamespaceAnalysis>;
}

export {};
