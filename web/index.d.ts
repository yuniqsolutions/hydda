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
export declare class Telemetry {
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
 * Default namespace used when no namespace is specified
 */
export declare const DEFAULT_NAMESPACE = "_default";
/**
 * Maximum safe integer for expires_at (never expires)
 * Using Number.MAX_SAFE_INTEGER (2^53 - 1) for JavaScript compatibility
 * This represents ~285 million years from epoch, which is effectively "never"
 */
export declare const NEVER_EXPIRES = 9007199254740991;
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
declare class TypedEventEmitter<TEvents extends Record<string, any>> {
	private listeners;
	/**
	 * Registers an event listener. Alias for `on`.
	 * @param event The name of the event to listen for.
	 * @param listener The callback function.
	 */
	addEventListener<E extends keyof TEvents>(event: E, listener: TEvents[E]): this;
	/**
	 * Registers an event listener.
	 * @param event The name of the event to listen for.
	 * @param listener The callback function.
	 */
	on<E extends keyof TEvents>(event: E, listener: TEvents[E]): this;
	/**
	 * Unregisters an event listener. Alias for `off`.
	 * @param event The name of the event to stop listening to.
	 * @param listener The callback function to remove.
	 */
	removeEventListener<E extends keyof TEvents>(event: E, listener: TEvents[E]): this;
	/**
	 * Unregisters an event listener.
	 * @param event The name of the event to stop listening to.
	 * @param listener The callback function to remove.
	 */
	off<E extends keyof TEvents>(event: E, listener: TEvents[E]): this;
	/**
	 * Emits an event, calling all registered listeners with the provided arguments.
	 * @param event The name of the event to emit.
	 * @param args The arguments to pass to the listeners.
	 * @returns `true` if the event had listeners, `false` otherwise.
	 */
	emit<E extends keyof TEvents>(event: E, ...args: Parameters<TEvents[E]>): boolean;
	/**
	 * Registers a listener that fires at most once, then removes itself.
	 * Removable beforehand by passing the original listener to `off`.
	 * @param event The name of the event to listen for.
	 * @param listener The callback function.
	 */
	once<E extends keyof TEvents>(event: E, listener: TEvents[E]): this;
	/**
	 * Number of listeners registered for an event.
	 * @param event The event name to count listeners for.
	 */
	listenerCount<E extends keyof TEvents>(event: E): number;
	/**
	 * Removes all listeners, or all listeners for the given event.
	 * @param event Optional event name to clear; clears everything when omitted.
	 */
	removeAllListeners<E extends keyof TEvents>(event?: E): this;
}
/**
 * Which underlying browser storage engine to use
 */
export type WebEngineType = "auto" | "indexeddb" | "localstorage";
/**
 * Encryption configuration (AES-GCM with PBKDF2 key derivation)
 */
export interface EncryptionConfig {
	/** Enable encryption for values written by this store instance */
	enabled: boolean;
	/** Password used for key derivation */
	key: string;
	/**
	 * Optional extra salt. The effective salt is always namespace-scoped
	 * (`namespace` or `namespace:salt`), so each namespace derives its own key.
	 */
	salt?: string;
	/**
	 * PBKDF2 iteration count. Stored in each ciphertext envelope, so
	 * raising it later keeps old data readable.
	 * @default 100000
	 */
	iterations?: number;
}
/**
 * Options for creating a Hydda instance.
 * Extends the shared KvStoreOptions with web-only settings.
 */
export interface WebKvStoreOptions extends KvStoreOptions {
	/**
	 * Storage engine selection.
	 * 'auto' prefers IndexedDB and falls back to localStorage.
	 * @default 'auto'
	 */
	engine?: WebEngineType;
	/**
	 * Use relaxed durability for IndexedDB readwrite transactions
	 * (faster writes on Chromium at a small durability cost).
	 * @default false
	 */
	relaxedDurability?: boolean;
	/**
	 * Encrypt stored values with AES-GCM. Keys are derived per namespace.
	 */
	encryption?: EncryptionConfig;
}
/**
 * A record as stored by a web engine. `value` is the serialized (and possibly
 * encrypted) string; `expiresAt` uses the NEVER_EXPIRES sentinel when the
 * entry has no TTL, matching the SQLite engines.
 */
export interface WebStorageRecord {
	namespace: string;
	key: string;
	/** Serialized value string (base64 when `enc` is 1) */
	value: string;
	/** 1 when the value string is encrypted */
	enc: number;
	createdAt: number;
	/** Raw expiry timestamp; NEVER_EXPIRES sentinel when no TTL */
	expiresAt: number;
	isDeleted: number;
	lastAccessed: number;
	/** Byte size of the stored value string */
	size: number;
}
/**
 * Entry for engine-level bulk set operations
 */
export interface WebBulkSetRecord {
	key: string;
	value: string;
	enc: number;
	ttl?: number;
}
/**
 * Engine-level batch operation (values already serialized/encrypted)
 */
export type WebEngineBatchOperation = {
	type: "put";
	namespace: string;
	key: string;
	value: string;
	enc: number;
	ttl?: number;
} | {
	type: "del";
	namespace: string;
	key: string;
};
/**
 * Configuration shared by web storage engines
 */
export interface WebEngineConfig {
	/** Database name (IndexedDB database / localStorage key prefix) */
	dbName: string;
	/** Soft delete mode: deletes write tombstones instead of removing records */
	softDelete: boolean;
	/** Track last-access timestamps for LRU eviction */
	trackLRU: boolean;
	/** Maximum active entries before evictLRU() trims */
	maxEntries: number;
	/** Relaxed durability for IndexedDB write transactions */
	relaxedDurability: boolean;
	/** Log engine debug messages */
	debug: boolean;
}
/**
 * Contract implemented by web storage engines (IndexedDB, localStorage).
 *
 * Mirrors the BaseStorageEngine surface of the SQLite engines, adapted to
 * string values. Engines emit `expire` and `evict` events (they originate
 * maintenance internally); the store emits `set` / `delete` events because
 * only it holds the caller's original values.
 */
export interface WebStorageEngine {
	readonly name: "indexeddb" | "localstorage";
	initialize(): Promise<void>;
	close(): Promise<void>;
	get(key: string, namespace?: string): Promise<WebStorageRecord | null>;
	set(key: string, value: string, enc: number, ttl?: number, namespace?: string): Promise<void>;
	delete(key: string, namespace?: string): Promise<boolean>;
	has(key: string, namespace?: string): Promise<boolean>;
	getMany(keys: string[], namespace?: string): Promise<Map<string, WebStorageRecord>>;
	setMany(entries: WebBulkSetRecord[], namespace?: string): Promise<void>;
	deleteMany(keys: string[], namespace?: string): Promise<number>;
	/** Mixed put+del operations, atomically in one transaction */
	batch(operations: WebEngineBatchOperation[]): Promise<void>;
	listKeys(options?: ListOptions): Promise<string[]>;
	listEntries(options?: ListOptions): Promise<WebStorageRecord[]>;
	getSize(type?: SizeType, options?: SizeOptions): Promise<number>;
	/** Update expiry of an existing active record; false if absent */
	setExpiry(key: string, expiresAt: number, namespace?: string): Promise<boolean>;
	clearExpired(): Promise<number>;
	clearDeleted(): Promise<number>;
	clearNamespace(namespace: string): Promise<number>;
	clearAll(): Promise<void>;
	evictLRU(targetCount?: number): Promise<number>;
	/** Flush any batched last-access updates */
	flushAccessUpdates(): Promise<void>;
	listNamespaces(): Promise<string[]>;
	getNamespaceStats(namespace: string): Promise<NamespaceStats>;
	getMetrics(): StorageMetrics;
	resetMetrics(): void;
}
/**
 * Batch operations accepted by Hydda.batch(): the shared BatchOperation
 * shape, plus the legacy web shape using `ttlSeconds`.
 */
export type WebBatchOperation<T = unknown> = BatchOperation<T> | {
	type: "put";
	key: string;
	value: T;
	ttlSeconds?: number;
	namespace?: string;
};
/**
 * List options accepted by Hydda, including legacy page-based pagination.
 */
export type WebListOptions = ListOptions;
export declare class Hydda {
	private readonly options;
	private readonly emitter;
	private readonly engine;
	private readonly tel;
	private readonly namespaceCache;
	private readonly cryptoManagers;
	private compactionTimer?;
	private evictionTimer?;
	private tombstoneCount;
	private writeCounter;
	private isCompacting;
	private isClosing;
	private dbName;
	private constructor();
	/**
	 * Creates and initializes a new Hydda instance.
	 */
	static create(options?: WebKvStoreOptions): Promise<Hydda>;
	private initialize;
	/**
	 * The storage engine in use ('indexeddb' or 'localstorage')
	 */
	get engineType(): "indexeddb" | "localstorage";
	on<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	off<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	addEventListener<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	removeEventListener<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	private cryptoFor;
	private encodeValue;
	/**
	 * Decode an engine record back to its value. Returns null (and emits an
	 * error) when an encrypted record can't be decrypted — e.g. wrong key, or
	 * encryption disabled for a store that holds encrypted data.
	 */
	private decodeRecord;
	/**
	 * Checks if a key exists and is active (not deleted, not expired).
	 */
	has(key: string, options?: KeyOptions): Promise<boolean>;
	/**
	 * Retrieves a value by key.
	 */
	get<T>(key: string, options?: KeyOptions): Promise<T | null>;
	/**
	 * Stores a value with optional TTL and namespace.
	 *
	 * @example
	 * ```typescript
	 * await store.set('key', value);                       // no TTL
	 * await store.set('key', value, 60);                   // TTL (legacy arg)
	 * await store.set('key', value, { ttl: 60 });          // options API
	 * await store.set('key', value, { namespace: 'users' });
	 * ```
	 */
	set<T>(key: string, value: T, ttlOrOptions?: number | SetOptions): Promise<void>;
	/**
	 * Deletes a key (soft delete writes a tombstone when enabled).
	 */
	delete(key: string, options?: KeyOptions): Promise<boolean>;
	/**
	 * Get multiple values at once (single transaction).
	 */
	getMany<T>(keys: string[], options?: KeyOptions): Promise<Map<string, T>>;
	/**
	 * Set multiple values at once (single transaction).
	 */
	setMany<T>(entries: BulkSetEntry<T>[], options?: KeyOptions): Promise<void>;
	/**
	 * Delete multiple keys at once (single transaction).
	 */
	deleteMany(keys: string[], options?: KeyOptions): Promise<number>;
	/**
	 * Execute mixed put/del operations atomically in a single transaction.
	 * Accepts both the shared BatchOperation shape (`ttl`) and the legacy web
	 * shape (`ttlSeconds`).
	 */
	batch(operations: WebBatchOperation[]): Promise<void>;
	/**
	 * Create a transaction builder for batch operations.
	 */
	createTransaction(): {
		put<T>(key: string, value: T, ttlSeconds?: number, namespace?: string): void;
		del(key: string, namespace?: string): void;
		commit(): Promise<void>;
		rollback(): void;
	};
	getSize(): Promise<number>;
	getSize(type: SizeType): Promise<number>;
	getSize(options: SizeOptions): Promise<number>;
	getSize(type: SizeType, options: SizeOptions): Promise<number>;
	private resolveListOptions;
	/**
	 * List keys matching criteria. Unlimited unless `limit` is provided.
	 */
	listKeys(options?: WebListOptions): Promise<string[]>;
	/**
	 * List key-value pairs matching criteria.
	 * Supports both `offset` and legacy `page` pagination.
	 */
	list<T>(options?: WebListOptions): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * List entries with storage metadata (createdAt, expiresAt,
	 * lastAccessed) — the raw material for data analysis.
	 */
	inspect(options?: WebListOptions): Promise<StorageEntry[]>;
	/**
	 * List all values matching criteria.
	 */
	values<T>(options?: WebListOptions): Promise<T[]>;
	/**
	 * Alias of list(): all entries as key-value pairs.
	 */
	entries<T>(options?: WebListOptions): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * Iterate entries. `options.limit` caps the total number of entries
	 * visited; return `false` from the callback to stop early.
	 */
	forEach<T>(callback: (key: string, value: T) => void | boolean | Promise<void | boolean>, options?: WebListOptions): Promise<void>;
	/**
	 * Search entries by key pattern (string or RegExp). With
	 * `searchValues: true` the pattern is also matched against the
	 * serialized value (decrypted first when encryption is on).
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
	 * Get a namespace-scoped store view.
	 */
	ns(namespace: string): INamespacedStore;
	/**
	 * Alias for ns()
	 */
	namespace(namespace: string): INamespacedStore;
	/**
	 * List all namespaces with active entries.
	 */
	listNamespaces(): Promise<string[]>;
	/**
	 * Clear all entries in a namespace.
	 */
	clearNamespace(namespace: string): Promise<number>;
	/**
	 * Get statistics for a namespace.
	 */
	getNamespaceStats(namespace: string): Promise<NamespaceStats>;
	/**
	 * Get global store statistics.
	 */
	getStats(): Promise<StoreStats>;
	getMetrics(): StorageMetrics;
	/**
	 * Rich telemetry snapshot (latency percentiles, hit rate, namespace
	 * activity, lifecycle counters, slow ops, rolling throughput window).
	 */
	getTelemetry(): TelemetrySnapshot;
	/**
	 * The live Telemetry instance (reset, enable/disable, toPrometheus).
	 */
	get telemetry(): Telemetry;
	resetMetrics(): void;
	clearSoftDeletedEntries(): Promise<number>;
	clearExpiredEntries(): Promise<number>;
	/**
	 * Clear all entries (writes tombstones in soft-delete mode).
	 */
	clear(): Promise<void>;
	/**
	 * Remove tombstones and expired entries.
	 */
	compact(): Promise<void>;
	/**
	 * Re-encrypt every active entry under a new encryption config (key
	 * rotation, iteration upgrades, or turning encryption on for existing
	 * plaintext data). Runs namespace by namespace with keyset pagination;
	 * TTLs are preserved (re-derived to whole seconds). Tombstones are not
	 * rewritten — run compact() first if that matters.
	 */
	rotateEncryption(next: {
		key: string;
		salt?: string;
		iterations?: number;
	}): Promise<number>;
	/**
	 * Count tombstones and schedule compaction past the threshold.
	 */
	private noteTombstone;
	/**
	 * Count writes and occasionally check limits using the engine's native
	 * count fast path (no cursor walk).
	 */
	private noteWrite;
	private runEviction;
	close(): Promise<void>;
}
export declare class IndexedDBEngine implements WebStorageEngine {
	readonly name: "indexeddb";
	private db;
	private isInitialized;
	private initPromise;
	private readonly config;
	private readonly emitter;
	private metrics;
	/** Pending LRU updates, keyed by JSON.stringify([namespace, key]) */
	private pendingAccessUpdates;
	private accessFlushTimer?;
	constructor(config: WebEngineConfig, emitter: TypedEventEmitter<KvStoreEvents>);
	initialize(): Promise<void>;
	/**
	 * Copy v1 records into the v2 store within the upgrade transaction.
	 * v1 stored raw structured-clone values without namespaces; they land in
	 * the default namespace with serialized string values.
	 */
	private migrateLegacyStore;
	close(): Promise<void>;
	private ensureInitialized;
	private readTx;
	private writeTx;
	/** Resolve when the transaction has committed */
	private done;
	/** Promisify a single request (reads) */
	private req;
	/** Key range covering every key in a namespace (primary-key order) */
	private nsRange;
	/** Key range covering keys with a prefix inside a namespace */
	private nsPrefixRange;
	private ns;
	private now;
	private expiresAt;
	private isActive;
	private toRecord;
	private makeRow;
	private trackMetric;
	private debug;
	getMetrics(): StorageMetrics;
	resetMetrics(): void;
	get(key: string, namespace?: string): Promise<WebStorageRecord | null>;
	/**
	 * Fire-and-forget removal of an expired record, re-validating expiry
	 * inside its own readwrite transaction.
	 */
	private expireKey;
	set(key: string, value: string, enc: number, ttl?: number, namespace?: string): Promise<void>;
	delete(key: string, namespace?: string): Promise<boolean>;
	has(key: string, namespace?: string): Promise<boolean>;
	getMany(keys: string[], namespace?: string): Promise<Map<string, WebStorageRecord>>;
	setMany(entries: WebBulkSetRecord[], namespace?: string): Promise<void>;
	deleteMany(keys: string[], namespace?: string): Promise<number>;
	batch(operations: WebEngineBatchOperation[]): Promise<void>;
	listEntries(options?: ListOptions): Promise<WebStorageRecord[]>;
	listKeys(options?: ListOptions): Promise<string[]>;
	getSize(type?: SizeType, options?: SizeOptions): Promise<number>;
	setExpiry(key: string, expiresAt: number, namespace?: string): Promise<boolean>;
	clearExpired(): Promise<number>;
	clearDeleted(): Promise<number>;
	clearNamespace(namespace: string): Promise<number>;
	clearAll(): Promise<void>;
	private queueAccessUpdate;
	flushAccessUpdates(): Promise<void>;
	evictLRU(targetCount?: number): Promise<number>;
	listNamespaces(): Promise<string[]>;
	getNamespaceStats(namespace: string): Promise<NamespaceStats>;
}
export declare class LocalStorageEngine implements WebStorageEngine {
	readonly name: "localstorage";
	private readonly config;
	private readonly emitter;
	private readonly prefix;
	private isInitialized;
	private metrics;
	constructor(config: WebEngineConfig, emitter: TypedEventEmitter<KvStoreEvents>);
	initialize(): Promise<void>;
	close(): Promise<void>;
	private storageKey;
	private parseStorageKey;
	private ns;
	private now;
	private expiresAt;
	private ensureInitialized;
	private readEnvelope;
	private writeEnvelope;
	private toRecord;
	private isActive;
	/**
	 * Iterate every record belonging to this engine.
	 * Collects keys first because mutating localStorage during index-based
	 * iteration skips entries.
	 */
	private iterate;
	private trackMetric;
	getMetrics(): StorageMetrics;
	resetMetrics(): void;
	get(key: string, namespace?: string): Promise<WebStorageRecord | null>;
	set(key: string, value: string, enc: number, ttl?: number, namespace?: string): Promise<void>;
	delete(key: string, namespace?: string): Promise<boolean>;
	has(key: string, namespace?: string): Promise<boolean>;
	getMany(keys: string[], namespace?: string): Promise<Map<string, WebStorageRecord>>;
	setMany(entries: WebBulkSetRecord[], namespace?: string): Promise<void>;
	deleteMany(keys: string[], namespace?: string): Promise<number>;
	batch(operations: WebEngineBatchOperation[]): Promise<void>;
	listEntries(options?: ListOptions): Promise<WebStorageRecord[]>;
	listKeys(options?: ListOptions): Promise<string[]>;
	getSize(type?: SizeType, options?: SizeOptions): Promise<number>;
	setExpiry(key: string, expiresAt: number, namespace?: string): Promise<boolean>;
	clearExpired(): Promise<number>;
	clearDeleted(): Promise<number>;
	clearNamespace(namespace: string): Promise<number>;
	clearAll(): Promise<void>;
	flushAccessUpdates(): Promise<void>;
	evictLRU(targetCount?: number): Promise<number>;
	listNamespaces(): Promise<string[]>;
	getNamespaceStats(namespace: string): Promise<NamespaceStats>;
}
/**
 * Check if IndexedDB is available in this environment
 */
export declare function isIndexedDBAvailable(): boolean;
/**
 * Check if localStorage is available (and writable) in this environment
 */
export declare function isLocalStorageAvailable(): boolean;
/**
 * Check whether the given engine type can run in this environment
 */
export declare function isEngineAvailable(engine: WebEngineType): boolean;
/**
 * Create the storage engine for the requested type.
 * 'auto' prefers IndexedDB and falls back to localStorage.
 */
export declare function createWebEngine(type: WebEngineType, config: WebEngineConfig, emitter: TypedEventEmitter<KvStoreEvents>): WebStorageEngine;
/**
 * Universal JavaScript value serializer shared by every Hydda store.
 *
 * Produces a plain string representation that round-trips rich types
 * (Date, Map, Set, RegExp, BigInt, typed arrays, Error, URL, NaN/Infinity,
 * undefined, ...) identically across SQLite, IndexedDB and localStorage,
 * and can be encrypted as an opaque string.
 *
 * Plain JSON values serialize to plain JSON, so data written by older
 * JSON-only versions reads back unchanged.
 */
/**
 * Serialize a JavaScript value to a storage string.
 */
export declare function serialize<T>(value: T): string;
/**
 * Deserialize a stored string back to its original JavaScript value.
 */
export declare function deserialize<T>(serialized: string): T;
/**
 * Cryptography utilities for the Hydda web adapter.
 * AES-GCM encryption with PBKDF2 key derivation via the Web Crypto API.
 */
/**
 * Check if the Web Crypto API is available
 */
export declare function isCryptoAvailable(): boolean;
export declare class CryptoManager {
	private password;
	private _salt;
	private iterations;
	/** Derived keys cached per iteration count (legacy reads may differ) */
	private keys;
	constructor(password: string, salt: Uint8Array | string, iterations?: number);
	/**
	 * Get or derive the encryption key for an iteration count (cached)
	 */
	private getKey;
	/**
	 * Pre-derive the write key (PBKDF2 is CPU-heavy; warming at startup
	 * keeps it off the first operation's critical path)
	 */
	warm(): Promise<unknown>;
	/**
	 * Encrypt data. Returns `iv + ciphertext`.
	 */
	encrypt(data: string): Promise<Uint8Array>;
	/**
	 * Decrypt data. Expects `iv (12 bytes) + ciphertext`.
	 */
	decrypt(encryptedData: Uint8Array): Promise<string>;
	/**
	 * Encrypt to a versioned storage string: `k2.<iterations>.<base64>`.
	 * The embedded iteration count lets future configs decrypt old data.
	 */
	encryptToBase64(data: string): Promise<string>;
	/**
	 * Decrypt a storage string — versioned envelopes and legacy raw base64
	 * (pre-envelope, fixed 100k iterations) both work.
	 */
	decryptFromBase64(stored: string): Promise<string>;
	private decryptWithKey;
}

export {
	Hydda as default,
};

export {};
