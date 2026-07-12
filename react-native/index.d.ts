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
export interface RNPutBatchOperation {
	type: "put";
	key: string;
	value: any;
	ttlSeconds?: number;
}
export interface RNDelBatchOperation {
	type: "del";
	key: string;
}
type RNBatchOperation = RNPutBatchOperation | RNDelBatchOperation;
export interface RNStorageEntry {
	key: string;
	value: any;
	createdAt: number;
	expiresAt?: number;
	isDeleted?: boolean;
}
declare abstract class BaseStorageManager {
	protected dbDir: string;
	protected dbName: string;
	protected emitter: TypedEventEmitter<KvStoreEvents>;
	protected softDelete: boolean;
	constructor(dbDir: string, dbName: string, emitter: TypedEventEmitter<KvStoreEvents>, softDelete?: boolean);
	abstract initialize(): Promise<any>;
	abstract close(): Promise<void>;
	abstract set(key: string, value: any, ttlSeconds?: number): Promise<void>;
	abstract get(key: string): Promise<RNStorageEntry | null>;
	abstract delete(key: string): Promise<boolean>;
	abstract has(key: string): Promise<boolean>;
	abstract keys(options?: {
		prefix?: string;
		suffix?: string;
	}): Promise<string[]>;
	abstract clear(): Promise<void>;
	abstract batch(operations: RNBatchOperation[]): Promise<void>;
	abstract getIncludingDeleted(key: string): Promise<RNStorageEntry | null>;
	abstract getAllKeysIncludingDeleted(): Promise<string[]>;
	abstract clearSoftDeletedEntries(): Promise<number>;
	abstract getDataFilePath(): string;
	abstract getIndexFilePath(): string;
	abstract getAllEntries(options?: {
		prefix?: string;
		suffix?: string;
		limit?: number;
	}): Promise<RNStorageEntry[]>;
	abstract getSize(type?: "active" | "deleted" | "expired" | "all", options?: {
		prefix?: string;
		suffix?: string;
	}): Promise<number>;
	abstract clearExpiredEntries(): Promise<number>;
	abstract evictLRUEntries(targetCount?: number): Promise<number>;
	abstract evictExpiredEntries(): Promise<number>;
}
/**
 * A high-performance, persistent Key-Value store for React Native with SQLite backend.
 * Supports TTL, soft deletes, compaction, and type-safe event handling.
 *
 * Automatically detects and uses available SQLite libraries:
 * - expo-sqlite (for Expo projects)
 * - react-native-sqlite-storage
 * - react-native-sqlite-2
 *
 * @example
 * ```typescript
 * import { Hydda } from 'hydda/react-native';
 *
 * const store = await Hydda.create({
 *   storage: {
 *     type: 'persistence',
 *     eviction: true,
 *     maxEntries: 10000
 *   },
 *   compactionInterval: 3600000,
 *   softDelete: true
 * });
 *
 * await store.set('key', { data: 'value' }, 60); // TTL of 60 seconds
 * const value = await store.get('key');
 * await store.delete('key');
 * await store.close();
 * ```
 */
export declare class Hydda {
	/** Configuration options for the store instance */
	private readonly options;
	/** Timer for automatic compaction operations */
	private compactionTimer?;
	/** Timer for automatic eviction of expired entries */
	private evictionTimer?;
	/** Counter for tracking deleted entries (tombstones) */
	private tombstoneCount;
	/** Flag indicating if compaction is currently in progress */
	private isCompacting;
	/** Flag indicating if the store is being closed */
	private isClosing;
	/** Event emitter for store events */
	private readonly emitter;
	/** Storage manager instance handling data persistence */
	private readonly storageManager;
	/** Database name for the storage file */
	private dbName;
	private constructor();
	/**
	 * Creates and initializes a new Hydda instance.
	 *
	 * @param options - Configuration options for the store
	 * @returns Promise that resolves to an initialized Hydda instance
	 *
	 * @example
	 * ```typescript
	 * const store = await Hydda.create({
	 *   storage: {
	 *     type: 'persistence',
	 *     eviction: true,
	 *     maxEntries: 50000
	 *   },
	 *   compactionInterval: 3600000
	 * });
	 * ```
	 */
	static create(options?: KvStoreOptions): Promise<Hydda>;
	private initialize;
	/**
	 * Registers an event listener for the specified event.
	 *
	 * @param event - The event name to listen for
	 * @param listener - The callback function to execute when the event is emitted
	 * @returns This Hydda instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * store.on('ready', () => console.log('Store is ready'));
	 * store.on('error', (error) => console.error('Store error:', error));
	 * ```
	 */
	on<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	/**
	 * Removes an event listener for the specified event.
	 *
	 * @param event - The event name to stop listening for
	 * @param listener - The callback function to remove
	 * @returns This Hydda instance for method chaining
	 */
	off<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	/**
	 * Alias for the `on` method. Registers an event listener.
	 *
	 * @param event - The event name to listen for
	 * @param listener - The callback function to execute when the event is emitted
	 * @returns This Hydda instance for method chaining
	 */
	addEventListener<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	/**
	 * Alias for the `off` method. Removes an event listener.
	 *
	 * @param event - The event name to stop listening for
	 * @param listener - The callback function to remove
	 * @returns This Hydda instance for method chaining
	 */
	removeEventListener<E extends keyof KvStoreEvents>(event: E, listener: KvStoreEvents[E]): this;
	/**
	 * Checks if a key exists in the store and is not expired.
	 *
	 * @param key - The key to check for existence
	 * @returns Promise that resolves to true if the key exists and is valid, false otherwise
	 *
	 * @example
	 * ```typescript
	 * const exists = await store.has('myKey');
	 * if (exists) {
	 *   console.log('Key exists');
	 * }
	 * ```
	 */
	has(key: string): Promise<boolean>;
	/**
	 * Retrieves a value from the store by its key.
	 *
	 * @template T - The expected type of the stored value
	 * @param key - The key to retrieve the value for
	 * @returns Promise that resolves to the stored value or null if not found/expired
	 *
	 * @example
	 * ```typescript
	 * const user = await store.get<User>('user:123');
	 * if (user) {
	 *   console.log('User found:', user.name);
	 * }
	 * ```
	 */
	get<T>(key: string): Promise<T | null>;
	/**
	 * Stores a value in the store with an optional TTL (Time To Live).
	 *
	 * @template T - The type of the value being stored
	 * @param key - The key to store the value under
	 * @param value - The value to store
	 * @param ttlSeconds - Optional TTL in seconds. If provided, the key will expire after this duration
	 * @returns Promise that resolves when the value is stored
	 *
	 * @example
	 * ```typescript
	 * // Store without TTL
	 * await store.set('user:123', { name: 'John', age: 30 });
	 *
	 * // Store with 60 second TTL
	 * await store.set('session:abc', { token: 'xyz' }, 60);
	 * ```
	 */
	set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
	/**
	 * Deletes a key from the store.
	 *
	 * @param key - The key to delete
	 * @returns Promise that resolves to true if the key was deleted, false if it didn't exist
	 *
	 * @example
	 * ```typescript
	 * const wasDeleted = await store.delete('user:123');
	 * if (wasDeleted) {
	 *   console.log('User deleted successfully');
	 * }
	 * ```
	 */
	delete(key: string): Promise<boolean>;
	/**
	 * Gets the number of active entries in the store.
	 *
	 * @returns Promise that resolves to the count of active entries
	 *
	 * @example
	 * ```typescript
	 * const count = await store.getSize();
	 * ```
	 */
	getSize(): Promise<number>;
	/**
	 * Gets the number of entries in the store by type.
	 *
	 * @param type - The type of entries to count: 'active', 'deleted', 'expired', or 'all'
	 * @returns Promise that resolves to the count of entries
	 *
	 * @example
	 * ```typescript
	 * const activeCount = await store.getSize('active');
	 * const totalCount = await store.getSize('all');
	 * ```
	 */
	getSize(type: "active" | "deleted" | "expired" | "all"): Promise<number>;
	/**
	 * Gets the number of active entries in the store with prefix filtering.
	 *
	 * @param options - Filtering options with prefix
	 * @param options.prefix - Only count entries with keys that start with this prefix
	 * @returns Promise that resolves to the count of entries matching the prefix
	 *
	 * @example
	 * ```typescript
	 * const userCount = await store.getSize({ prefix: 'user:' });
	 * ```
	 */
	getSize(options: {
		prefix: string;
	}): Promise<number>;
	/**
	 * Gets the number of entries in the store with suffix filtering.
	 *
	 * @param options - Filtering options with suffix
	 * @param options.suffix - Only count entries with keys that end with this suffix
	 * @returns Promise that resolves to the count of entries
	 *
	 * @example
	 * ```typescript
	 * const sessionCount = await store.getSize({ suffix: ':session' });
	 * ```
	 */
	getSize(options: {
		suffix: string;
	}): Promise<number>;
	/**
	 * Gets the number of entries in the store by type with prefix filtering.
	 *
	 * @param type - The type of entries to count: 'active', 'deleted', 'expired', or 'all'
	 * @param options - Filtering options with prefix
	 * @param options.prefix - Only count entries with keys that start with this prefix
	 * @returns Promise that resolves to the count of entries
	 *
	 * @example
	 * ```typescript
	 * const activeUserCount = await store.getSize('active', { prefix: 'user:' });
	 * ```
	 */
	getSize(type: "active" | "deleted" | "expired" | "all", options: {
		prefix: string;
	}): Promise<number>;
	/**
	 * Gets the number of entries in the store by type with suffix filtering.
	 *
	 * @param type - The type of entries to count: 'active', 'deleted', 'expired', or 'all'
	 * @param options - Filtering options with suffix
	 * @param options.suffix - Only count entries with keys that end with this suffix
	 * @returns Promise that resolves to the count of entries
	 *
	 * @example
	 * ```typescript
	 * const activeSessionCount = await store.getSize('active', { suffix: ':session' });
	 * ```
	 */
	getSize(type: "active" | "deleted" | "expired" | "all", options: {
		suffix: string;
	}): Promise<number>;
	/**
	 * Lists all keys in the store.
	 *
	 * @returns Promise that resolves to an array of all keys
	 *
	 * @example
	 * ```typescript
	 * const allKeys = await store.listKeys();
	 * ```
	 */
	listKeys(): Promise<string[]>;
	/**
	 * Lists all keys in the store that start with the specified prefix.
	 *
	 * @param options - Filtering options with prefix
	 * @param options.prefix - Only return keys that start with this prefix
	 * @returns Promise that resolves to an array of matching keys
	 *
	 * @example
	 * ```typescript
	 * const userKeys = await store.listKeys({ prefix: 'user:' });
	 * ```
	 */
	listKeys(options: {
		prefix: string;
	}): Promise<string[]>;
	/**
	 * Lists all keys in the store that end with the specified suffix.
	 *
	 * @param options - Filtering options with suffix
	 * @param options.suffix - Only return keys that end with this suffix
	 * @returns Promise that resolves to an array of matching keys
	 *
	 * @example
	 * ```typescript
	 * const sessionKeys = await store.listKeys({ suffix: ':session' });
	 * ```
	 */
	listKeys(options: {
		suffix: string;
	}): Promise<string[]>;
	/**
	 * Iterates over all key-value pairs in the store that match the given criteria.
	 *
	 * @template T - The expected type of the stored values
	 * @param callback - Function to call for each key-value pair
	 * @param options - Filtering and limiting options
	 * @param options.prefix - Only iterate over keys that start with this prefix
	 * @param options.suffix - Only iterate over keys that end with this suffix
	 * @param options.limit - Maximum number of entries to iterate over
	 * @returns Promise that resolves when iteration is complete
	 *
	 * @example
	 * ```typescript
	 * await store.forEach<User>((key, user) => {
	 *   console.log(`User ${key}: ${user.name}`);
	 * }, { prefix: 'user:', limit: 100 });
	 * ```
	 */
	forEach<T>(callback: (key: string, value: T) => void, options?: {
		prefix?: string;
		suffix?: string;
		limit?: number;
	}): Promise<void>;
	/**
	 * Retrieves a list of key-value pairs that match the given criteria with pagination support.
	 *
	 * @template T - The expected type of the stored values
	 * @param options - Filtering, limiting, and pagination options
	 * @param options.prefix - Only return entries with keys that start with this prefix
	 * @param options.suffix - Only return entries with keys that end with this suffix
	 * @param options.limit - Maximum number of entries to return (default: 100)
	 * @param options.page - Page number for pagination (default: 1)
	 * @returns Promise that resolves to an array of key-value pairs
	 *
	 * @example
	 * ```typescript
	 * // Get first 50 users
	 * const users = await store.list<User>({
	 *   prefix: 'user:',
	 *   limit: 50,
	 *   page: 1
	 * });
	 *
	 * users.forEach(({ key, value }) => {
	 *   console.log(`${key}: ${value.name}`);
	 * });
	 * ```
	 */
	list<T>(options?: {
		prefix?: string;
		suffix?: string;
		limit?: number;
		page?: number;
	}): Promise<Array<{
		key: string;
		value: T;
	}>>;
	/**
	 * Permanently removes all soft-deleted entries from the store.
	 *
	 * @returns Promise that resolves to the number of entries that were permanently deleted
	 *
	 * @example
	 * ```typescript
	 * const deletedCount = await store.clearSoftDeletedEntries();
	 * console.log(`Permanently deleted ${deletedCount} entries`);
	 * ```
	 */
	clearSoftDeletedEntries(): Promise<number>;
	/**
	 * Permanently removes all expired entries from the store.
	 * An entry is considered expired if its TTL has elapsed.
	 * This method can be called manually to free up storage space.
	 *
	 * @returns Promise that resolves to the number of expired entries that were removed
	 *
	 * @throws {Error} If there is an error accessing the storage
	 *
	 * @example
	 * ```typescript
	 * // Remove all expired entries and get count
	 * const removedCount = await store.clearExpiredEntries();
	 * console.log(`Removed ${removedCount} expired entries`);
	 * ```
	 *
	 * @see {@link clearSoftDeletedEntries} for removing soft-deleted entries
	 */
	clearExpiredEntries(): Promise<number>;
	/**
	 * Manually triggers compaction of the store to reclaim space and improve performance.
	 * Compaction removes soft-deleted entries and optimizes the storage structure.
	 *
	 * @returns Promise that resolves when compaction is complete
	 *
	 * @example
	 * ```typescript
	 * // Manually trigger compaction
	 * await store.compact();
	 * console.log('Store compaction completed');
	 * ```
	 */
	compact(): Promise<void>;
	private checkAndTriggerCompaction;
	/**
	 * Executes multiple operations atomically in a single transaction.
	 *
	 * @param operations - Array of operations to execute
	 * @returns Promise that resolves when all operations are complete
	 *
	 * @example
	 * ```typescript
	 * await store.batch([
	 *   { type: 'put', key: 'user:1', value: { name: 'John' } },
	 *   { type: 'put', key: 'user:2', value: { name: 'Jane' } },
	 *   { type: 'del', key: 'user:3' }
	 * ]);
	 * ```
	 */
	batch(operations: RNBatchOperation[]): Promise<void>;
	/**
	 * Creates a new transaction for batching multiple operations.
	 * Transactions provide ACID guarantees and can be committed or rolled back.
	 *
	 * @returns Transaction object with put, del, commit, and rollback methods
	 *
	 * @example
	 * ```typescript
	 * const tx = store.createTransaction();
	 * try {
	 *   tx.put('user:1', { name: 'John' });
	 *   tx.put('user:2', { name: 'Jane' });
	 *   tx.del('user:3');
	 *   await tx.commit();
	 * } catch (error) {
	 *   tx.rollback();
	 *   throw error;
	 * }
	 * ```
	 */
	createTransaction(): {
		put<T>(key: string, value: T, ttlSeconds?: number): void;
		del(key: string): void;
		commit(): Promise<void>;
		rollback(): void;
	};
	/**
	 * Closes the store and releases all resources.
	 * This should be called when the store is no longer needed.
	 *
	 * @returns Promise that resolves when the store is fully closed
	 *
	 * @example
	 * ```typescript
	 * // Gracefully close the store
	 * await store.close();
	 * console.log('Store closed successfully');
	 * ```
	 */
	close(): Promise<void>;
	private checkAndTriggerEviction;
	private evictExpiredEntries;
	private evictLRUIfNeeded;
}
/**
 * React Native SQLite dependency detector
 * Checks for available SQLite libraries and returns the appropriate adapter
 */
export interface SQLiteLibrary {
	name: string;
	version: string;
	adapter: "expo-sqlite" | "react-native-sqlite-storage" | "react-native-sqlite-2";
	available: boolean;
}
export declare class SQLiteDetector {
	private static detectedLibrary;
	/**
	 * Detect available SQLite library
	 */
	static detectSQLiteLibrary(): Promise<SQLiteLibrary>;
	/**
	 * Get installation instructions for missing SQLite library
	 */
	static getInstallationInstructions(): string;
	/**
	 * Reset detection cache (useful for testing)
	 */
	static resetDetection(): void;
}
export type DatabaseType = any;
export declare class ReactNativeStorageManager extends BaseStorageManager {
	private db?;
	protected dbName: string;
	private isInitialized;
	private config;
	private isMemoryMode;
	private maxEntries;
	private maxMemory;
	private sqliteLibrary;
	private adapterType;
	constructor(dbDir: string, dbName: string, emitter: TypedEventEmitter<KvStoreEvents>, softDelete?: boolean, config?: any);
	private initializeSQLiteLibrary;
	initialize(): Promise<DatabaseType>;
	private openDatabase;
	private createTables;
	private executeSql;
	private executeSqlWithResult;
	close(): Promise<void>;
	private valueToString;
	private stringToValue;
	set(key: string, value: any, ttlSeconds?: number): Promise<void>;
	get(key: string): Promise<RNStorageEntry | null>;
	delete(key: string): Promise<boolean>;
	has(key: string): Promise<boolean>;
	keys(options?: {
		prefix?: string;
		suffix?: string;
	}): Promise<string[]>;
	getSize(type?: "active" | "deleted" | "expired" | "all", options?: {
		prefix?: string;
		suffix?: string;
	}): Promise<number>;
	clear(): Promise<void>;
	batch(operations: RNBatchOperation[]): Promise<void>;
	getIncludingDeleted(key: string): Promise<RNStorageEntry | null>;
	getAllKeysIncludingDeleted(): Promise<string[]>;
	clearSoftDeletedEntries(): Promise<number>;
	clearExpiredEntries(): Promise<number>;
	evictLRUEntries(targetCount?: number): Promise<number>;
	evictExpiredEntries(): Promise<number>;
	getIndexFilePath(): string;
	getDataFilePath(): string;
	getAllEntries(options?: {
		prefix?: string;
		suffix?: string;
		limit?: number;
	}): Promise<RNStorageEntry[]>;
}

export {
	Hydda as default,
	RNBatchOperation as BatchOperation,
};

export {};
