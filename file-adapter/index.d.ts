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
export interface FileStorageEntry {
	key: string;
	namespace?: string;
	fileName: string;
	createdAt: number;
	expiresAt?: number;
	isDeleted?: boolean;
	lastAccessed: number;
	dataSize: number;
	dataType: "object" | "array" | "string" | "buffer";
	isEncryptedNamespace: boolean;
}
export interface FileAdapterOptions {
	/**
	 * Directory for storing cache files and metadata
	 * @default './cache'
	 */
	cacheDir?: string;
	/**
	 * Default Time-To-Live (TTL) for keys in seconds
	 * @default 0 (no expiration)
	 */
	ttl?: number;
	/**
	 * Enable LRU eviction when maxItems is reached
	 * @default false
	 */
	eviction?: boolean;
	/**
	 * Maximum number of items before eviction (only used if eviction is true)
	 * @default 1000000
	 */
	maxItems?: number;
	/**
	 * Enable debug mode to log detailed operations and performance metrics
	 * When enabled, logs will include:
	 * - File operations (read/write/delete)
	 * - Cache hits/misses
	 * - Eviction events
	 * - Timing information
	 * @default false
	 */
	debug?: boolean;
	/**
	 * LRU eviction interval in milliseconds (only used if eviction is true)
	 * @default 60000 (1 minute)
	 */
	evictionInterval?: number;
	/**
	 * Enable soft delete mode
	 * @default true
	 */
	softDelete?: boolean;
	/**
	 * Encrypt namespace directory names
	 * @default false
	 */
	encryptNamespace?: boolean;
	/**
	 * Size of the in-memory hot cache for frequently accessed entries.
	 * Hot cache provides O(1) access for recent items without disk I/O.
	 * Set to 0 to disable hot caching.
	 * @default 1000
	 */
	hotCacheSize?: number;
	/**
	 * Keep the Node.js process alive while the cacher is open.
	 * When false, internal timers are unref'd so they don't prevent exit.
	 * @default false
	 */
	keepAlive?: boolean;
	/**
	 * SQLite configuration
	 */
	sqlite?: {
		journalMode?: "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY" | "WAL" | "OFF";
		synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
		cacheSize?: number;
		tempStore?: "default" | "file" | "memory";
		foreignKeys?: boolean;
		busyTimeout?: number;
	};
}
export interface FileBatchOperation {
	type: "put" | "del";
	key: string;
	value?: any;
	ttlSeconds?: number;
	namespace?: string;
}
/**
 * Cacher - A high-performance file-based caching system
 *
 * Features:
 * - SQLite metadata storage with file-based data
 * - TTL support with automatic expiration
 * - Event-driven architecture
 * - Type-safe operations
 * - Batch operations support
 * - Namespace support for organized data storage
 */
export declare class Cacher extends TypedEventEmitter<KvStoreEvents> {
	private storageManager;
	private options;
	private isInitialized;
	private evictionTimer?;
	private constructor();
	/**
	 * Create and initialize a new Cacher instance
	 */
	static create(options?: FileAdapterOptions): Promise<Cacher>;
	/**
	 * Initialize the cacher (private method, called automatically by create)
	 */
	private initialize;
	/**
	 * Start the LRU eviction timer
	 */
	private startEvictionTimer;
	/**
	 * Store data without TTL and namespace
	 */
	set(key: string, value: any): Promise<void>;
	/**
	 * Store data with TTL but without namespace
	 */
	set(key: string, value: any, ttl: number): Promise<void>;
	/**
	 * Store data without TTL but with namespace
	 */
	set(key: string, value: any, namespace: string): Promise<void>;
	/**
	 * Store data with both TTL and namespace
	 */
	set(key: string, value: any, ttl: number, namespace: string): Promise<void>;
	/**
	 * Get data by key without namespace
	 */
	get<T = any>(key: string): Promise<T | null>;
	/**
	 * Get data by key with namespace
	 */
	get<T = any>(key: string, namespace: string): Promise<T | null>;
	/**
	 * Check if key exists without namespace
	 */
	has(key: string): Promise<boolean>;
	/**
	 * Check if key exists with namespace
	 */
	has(key: string, namespace: string): Promise<boolean>;
	/**
	 * Delete data by key without namespace
	 */
	delete(key: string): Promise<boolean>;
	/**
	 * Delete data by key with namespace
	 */
	delete(key: string, namespace: string): Promise<boolean>;
	/**
	 * Get all keys in the cache
	 */
	keys(): Promise<string[]>;
	/**
	 * Get all keys in a specific namespace
	 */
	keys(namespace: string): Promise<string[]>;
	/**
	 * Clear all entries from the cache
	 */
	clear(): Promise<void>;
	/**
	 * Clear all entries in a specific namespace
	 */
	clear(namespace: string): Promise<void>;
	/**
	 * Get cache size (number of entries)
	 */
	size(): Promise<number>;
	/**
	 * Clear expired entries
	 */
	clearExpired(): Promise<number>;
	/**
	 * Perform batch operations
	 */
	batch(operations: FileBatchOperation[]): Promise<void>;
	/**
	 * Get cache statistics
	 */
	getStats(): Promise<{
		totalEntries: number;
		totalSize: number;
		expiredEntries: number;
		hotCache: {
			size: number;
			maxSize: number;
			hitRate: number;
		};
		pendingUpdates: number;
	}>;
	/**
	 * Close the cacher and cleanup resources
	 */
	close(): Promise<void>;
	/**
	 * Event listener methods (inherited from TypedEventEmitter)
	 */
	/**
	 * Add event listener
	 */
	addEventListener<K extends keyof KvStoreEvents>(event: K, listener: KvStoreEvents[K]): this;
	/**
	 * Remove event listener
	 */
	removeEventListener<K extends keyof KvStoreEvents>(event: K, listener: KvStoreEvents[K]): this;
}

export {};
