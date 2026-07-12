import l from"node:path";import I from"node:fs/promises";import h from"node:fs/promises";import N from"node:path";import U from"node:crypto";function C(r){return U.createHash("sha256").update(r).digest("hex").substring(0,16)}function R(r){return`${C(r)}.bin`}function p(r,e){return e?`${e}:${r}`:r}function M(r){return r.replace(/[\/\\]/g,"_").replace(/[<>:"|?*]/g,"_").replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i,"$1_").replace(/[. ]+$/,"")||"default"}function m(r,e,t=!1){if(e){let s=t?C(e):M(e);return N.join(r,s)}return r}function w(r){if(Buffer.isBuffer(r))return"buffer";if(Array.isArray(r))return"array";if(typeof r=="string")return"string";if(typeof r=="object"&&r!==null)return"object";if(typeof r=="number"||typeof r=="boolean"||typeof r=="bigint")return"string";throw new Error("Unsupported data type. Only objects, arrays, strings, numbers, booleans, and buffers are supported.")}var v=Buffer.from("yq-cacher-key-2024","utf8"),k=["hydda-cache-key","lagr-cache-key","kvist-cache-key"].map(r=>Buffer.from(r,"utf8"));function L(r,e){let t=Buffer.from(r);for(let s=0;s<t.length;s++)t[s]^=e[s%e.length];return t}function b(r){let e=JSON.stringify(r);return L(Buffer.from(e,"utf8"),v)}function O(r){for(let t of[v,...k])try{return{value:JSON.parse(L(r,t).toString("utf8")),usedLegacyKey:t!==v}}catch{}let e=new Error("Cache payload could not be decoded with any known key");throw e.code="HYDDA_CACHE_DECODE",e}async function u(r){try{await h.mkdir(r,{recursive:!0})}catch(e){if(e.code!=="EEXIST")throw e}}async function x(r,e){let t=`${r}.tmp`;try{let s=N.dirname(r);await u(s),await h.writeFile(t,e),await h.rename(t,r)}catch(s){try{await h.unlink(t)}catch{}throw s}}async function F(r){try{return await h.access(r),!0}catch{return!1}}async function f(r){try{return await h.unlink(r),!0}catch{return!1}}async function E(r,e,t=!0){if(e)try{let s=m(r,e,t);try{await h.access(s)}catch{return}(await h.readdir(s)).length===0&&await h.rmdir(s)}catch{}}var g=class{db;dbFilePath;cacheDir;isInitialized=!1;options;emitter;statements;hotCache=new Map;hotCacheHead=null;hotCacheTail=null;maxHotCacheSize;pendingAccessUpdates=new Map;accessFlushTimer;accessFlushInterval=1e3;maxPendingUpdates=100;constructor(e,t){this.options={...this.getDefaultOptions(),...e},this.emitter=t,this.cacheDir=this.options.cacheDir||"./cache",this.dbFilePath=l.join(this.cacheDir,"meta.yqc"),this.maxHotCacheSize=this.options.hotCacheSize??1e3}getDefaultOptions(){return{cacheDir:"./cache",ttl:0,eviction:!1,maxItems:1e6,evictionInterval:6e4,softDelete:!0,hotCacheSize:1e3,keepAlive:!1,sqlite:{journalMode:"WAL",synchronous:"NORMAL",cacheSize:-1e5,tempStore:"memory",foreignKeys:!1,busyTimeout:5e3}}}isBunRuntime(){return typeof Bun<"u"&&!!Bun?.version}async initialize(){if(this.isBunRuntime()){if(this.db)return this.db;await u(l.dirname(this.dbFilePath)),await u(this.cacheDir);let{Database:e}=await import("bun:sqlite");return this.db=new e(this.dbFilePath),this.configurePragmas(),this.createTables(),this.prepareStatements(),this.startAccessFlushTimer(),this.isInitialized=!0,this.db}return new Promise(async(e,t)=>{try{await u(l.dirname(this.dbFilePath)),await u(this.cacheDir);let{DatabaseSync:s}=await import("node:sqlite");this.db=new s(this.dbFilePath),this.configurePragmas(),this.createTables(),this.prepareStatements(),this.startAccessFlushTimer(),this.isInitialized=!0,e(this.db)}catch(s){t(s)}})}configurePragmas(){if(!this.db)return;let e=this.options.sqlite||{};this.db.exec(`PRAGMA journal_mode = ${e.journalMode||"WAL"};`),this.db.exec(`PRAGMA synchronous = ${e.synchronous||"NORMAL"};`),this.db.exec(`PRAGMA cache_size = ${e.cacheSize||-1e5};`),this.db.exec(`PRAGMA temp_store = ${e.tempStore||"memory"};`),this.db.exec(`PRAGMA foreign_keys = ${e.foreignKeys?"ON":"OFF"};`),this.db.exec("PRAGMA mmap_size = 268435456;"),this.db.exec("PRAGMA page_size = 4096;"),e.busyTimeout&&this.db.exec(`PRAGMA busy_timeout = ${e.busyTimeout};`)}createTables(){if(!this.db)throw new Error("Database not initialized");this.db.exec(`
            CREATE TABLE IF NOT EXISTS file_metadata (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL,
                namespace TEXT,
                file_name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                last_accessed INTEGER NOT NULL DEFAULT 0,
                data_size INTEGER NOT NULL DEFAULT 0,
                data_type TEXT NOT NULL,
                is_encrypted_namespace INTEGER NOT NULL DEFAULT 0
            ) WITHOUT ROWID;

            -- Composite index for active record queries (main query pattern)
            CREATE INDEX IF NOT EXISTS idx_file_active
                ON file_metadata(is_deleted, expires_at, id)
                WHERE is_deleted = 0;

            -- Namespace-scoped active records
            CREATE INDEX IF NOT EXISTS idx_file_ns_active
                ON file_metadata(namespace, is_deleted, expires_at, key)
                WHERE is_deleted = 0;

            -- LRU eviction index
            CREATE INDEX IF NOT EXISTS idx_file_lru
                ON file_metadata(last_accessed)
                WHERE is_deleted = 0;

            -- Expiration cleanup index
            CREATE INDEX IF NOT EXISTS idx_file_expiry
                ON file_metadata(expires_at)
                WHERE is_deleted = 0 AND expires_at IS NOT NULL;
        `)}prepareStatements(){if(!this.db)throw new Error("Database not initialized");if(this.isBunRuntime()){let e=this.db;this.statements={insertOrReplace:e.prepare(`
                    INSERT OR REPLACE INTO file_metadata
                    (id, key, namespace, file_name, created_at, expires_at, is_deleted, last_accessed, data_size, data_type, is_encrypted_namespace)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
                `),selectById:e.prepare(`
                    SELECT id, key, namespace, file_name, created_at, expires_at, is_deleted, last_accessed, data_size, data_type, is_encrypted_namespace
                    FROM file_metadata
                    WHERE id = ? AND is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)
                `),updateLastAccessed:e.prepare(`
                    UPDATE file_metadata SET last_accessed = ? WHERE id = ?
                `),softDelete:e.prepare(`
                    UPDATE file_metadata SET is_deleted = 1 WHERE id = ?
                `),hardDelete:e.prepare(`
                    DELETE FROM file_metadata WHERE id = ?
                `),selectAllKeys:e.prepare(`
                    SELECT key FROM file_metadata
                    WHERE is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)
                    ORDER BY key
                `),selectKeysByNamespace:e.prepare(`
                    SELECT key FROM file_metadata
                    WHERE namespace = ? AND is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)
                    ORDER BY key
                `),selectFileInfoByNamespace:e.prepare(`
                    SELECT key, namespace, file_name, is_encrypted_namespace FROM file_metadata
                    WHERE namespace = ? AND is_deleted = 0
                `),countActive:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata
                    WHERE is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)
                `),countDeleted:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata WHERE is_deleted = 1
                `),countExpired:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata
                    WHERE is_deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ?
                `),countAll:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata
                `),countActiveEntries:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata WHERE is_deleted = 0
                `),selectExpiredEntries:e.prepare(`
                    SELECT key, namespace, file_name, is_encrypted_namespace FROM file_metadata
                    WHERE is_deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ?
                `),deleteExpired:e.prepare(`
                    DELETE FROM file_metadata
                    WHERE is_deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ?
                `),selectLRUEntries:e.prepare(`
                    SELECT key, namespace, file_name, is_encrypted_namespace, id FROM file_metadata
                    WHERE is_deleted = 0
                    ORDER BY last_accessed ASC
                    LIMIT ?
                `),batchUpdateAccessed:e.prepare(`
                    UPDATE file_metadata SET last_accessed = ? WHERE id = ?
                `)}}else{let e=this.db;this.statements={insertOrReplace:e.prepare(`
                    INSERT OR REPLACE INTO file_metadata
                    (id, key, namespace, file_name, created_at, expires_at, is_deleted, last_accessed, data_size, data_type, is_encrypted_namespace)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
                `),selectById:e.prepare(`
                    SELECT id, key, namespace, file_name, created_at, expires_at, is_deleted, last_accessed, data_size, data_type, is_encrypted_namespace
                    FROM file_metadata
                    WHERE id = ? AND is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)
                `),updateLastAccessed:e.prepare(`
                    UPDATE file_metadata SET last_accessed = ? WHERE id = ?
                `),softDelete:e.prepare(`
                    UPDATE file_metadata SET is_deleted = 1 WHERE id = ?
                `),hardDelete:e.prepare(`
                    DELETE FROM file_metadata WHERE id = ?
                `),selectAllKeys:e.prepare(`
                    SELECT key FROM file_metadata
                    WHERE is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)
                    ORDER BY key
                `),selectKeysByNamespace:e.prepare(`
                    SELECT key FROM file_metadata
                    WHERE namespace = ? AND is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)
                    ORDER BY key
                `),selectFileInfoByNamespace:e.prepare(`
                    SELECT key, namespace, file_name, is_encrypted_namespace FROM file_metadata
                    WHERE namespace = ? AND is_deleted = 0
                `),countActive:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata
                    WHERE is_deleted = 0 AND (expires_at IS NULL OR expires_at > ?)
                `),countDeleted:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata WHERE is_deleted = 1
                `),countExpired:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata
                    WHERE is_deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ?
                `),countAll:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata
                `),countActiveEntries:e.prepare(`
                    SELECT COUNT(*) as count FROM file_metadata WHERE is_deleted = 0
                `),selectExpiredEntries:e.prepare(`
                    SELECT key, namespace, file_name, is_encrypted_namespace FROM file_metadata
                    WHERE is_deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ?
                `),deleteExpired:e.prepare(`
                    DELETE FROM file_metadata
                    WHERE is_deleted = 0 AND expires_at IS NOT NULL AND expires_at <= ?
                `),selectLRUEntries:e.prepare(`
                    SELECT key, namespace, file_name, is_encrypted_namespace, id FROM file_metadata
                    WHERE is_deleted = 0
                    ORDER BY last_accessed ASC
                    LIMIT ?
                `),batchUpdateAccessed:e.prepare(`
                    UPDATE file_metadata SET last_accessed = ? WHERE id = ?
                `)}}}startAccessFlushTimer(){this.accessFlushTimer&&clearInterval(this.accessFlushTimer),this.accessFlushTimer=setInterval(()=>{this.flushAccessUpdates()},this.accessFlushInterval),!this.options.keepAlive&&this.accessFlushTimer.unref&&this.accessFlushTimer.unref()}flushAccessUpdates(){if(this.pendingAccessUpdates.size===0||!this.db||!this.statements)return;let e=Array.from(this.pendingAccessUpdates.entries());if(this.pendingAccessUpdates.clear(),this.isBunRuntime()){let t=this.db;t.exec("BEGIN IMMEDIATE");try{for(let[s,a]of e)this.statements.batchUpdateAccessed.run(a,s);t.exec("COMMIT")}catch(s){t.exec("ROLLBACK"),this.options.debug&&console.warn("Failed to flush access updates:",s)}}else{let t=this.db;t.exec("BEGIN IMMEDIATE");try{for(let[s,a]of e)this.statements.batchUpdateAccessed.run(a,s);t.exec("COMMIT")}catch(s){t.exec("ROLLBACK"),this.options.debug&&console.warn("Failed to flush access updates:",s)}}}queueAccessUpdate(e){this.pendingAccessUpdates.set(e,Date.now()),this.pendingAccessUpdates.size>=this.maxPendingUpdates&&this.flushAccessUpdates()}addToHotCache(e,t,s){if(this.maxHotCacheSize<=0)return;if(this.hotCache.has(e)){this.moveToFrontOfHotCache(e);let i=this.hotCache.get(e);i.value=t,i.entry=s;return}for(;this.hotCache.size>=this.maxHotCacheSize&&this.hotCacheTail;)this.evictFromHotCache();let a={value:t,entry:s,prev:null,next:this.hotCacheHead};if(this.hotCacheHead){let i=this.hotCache.get(this.hotCacheHead);i&&(i.prev=e)}this.hotCache.set(e,a),this.hotCacheHead=e,this.hotCacheTail||(this.hotCacheTail=e)}getFromHotCache(e){let t=this.hotCache.get(e);return t?t.entry.expiresAt&&t.entry.expiresAt<=Date.now()?(this.removeFromHotCache(e),null):(this.moveToFrontOfHotCache(e),{value:t.value,entry:t.entry}):null}moveToFrontOfHotCache(e){if(this.hotCacheHead===e)return;let t=this.hotCache.get(e);if(t){if(t.prev){let s=this.hotCache.get(t.prev);s&&(s.next=t.next)}if(t.next){let s=this.hotCache.get(t.next);s&&(s.prev=t.prev)}if(this.hotCacheTail===e&&(this.hotCacheTail=t.prev),t.prev=null,t.next=this.hotCacheHead,this.hotCacheHead){let s=this.hotCache.get(this.hotCacheHead);s&&(s.prev=e)}this.hotCacheHead=e}}removeFromHotCache(e){let t=this.hotCache.get(e);if(t){if(t.prev){let s=this.hotCache.get(t.prev);s&&(s.next=t.next)}else this.hotCacheHead=t.next;if(t.next){let s=this.hotCache.get(t.next);s&&(s.prev=t.prev)}else this.hotCacheTail=t.prev;this.hotCache.delete(e)}}evictFromHotCache(){this.hotCacheTail&&this.removeFromHotCache(this.hotCacheTail)}clearHotCache(){this.hotCache.clear(),this.hotCacheHead=null,this.hotCacheTail=null}async close(){if(this.flushAccessUpdates(),this.accessFlushTimer&&(clearInterval(this.accessFlushTimer),this.accessFlushTimer=void 0),this.clearHotCache(),this.isBunRuntime()){if(this.db)try{this.db.close(),this.db=void 0}catch(e){this.options.debug&&console.warn("Warning: Error closing Bun SQLite database:",e),this.db=void 0}this.isInitialized=!1,this.statements=void 0,this.emitter.emit("close");return}return new Promise((e,t)=>{try{this.db&&(this.db.close(),this.db=void 0),this.isInitialized=!1,this.statements=void 0,this.emitter.emit("close"),e()}catch(s){t(s)}})}async set(e,t,s,a){if(!this.isInitialized||!this.statements)throw new Error("Storage not initialized");let i=Date.now(),n=s?i+s*1e3:this.options.ttl?i+this.options.ttl*1e3:null,c=w(t),o=R(e),d=m(this.cacheDir,a,this.options.encryptNamespace),y=l.join(d,o);await u(d);let T=b(t);await x(y,T);let S=p(e,a),D=this.options.encryptNamespace?1:0;this.statements.insertOrReplace.run(S,e,a||null,o,i,n,i,T.length,c,D);let P={key:e,namespace:a,fileName:o,createdAt:i,expiresAt:n??void 0,isDeleted:!1,lastAccessed:i,dataSize:T.length,dataType:c,isEncryptedNamespace:!!D};this.addToHotCache(S,t,P),this.emitter.emit("set",e,t)}async get(e,t){if(!this.isInitialized||!this.statements)return null;let s=Date.now(),a=p(e,t),i=this.getFromHotCache(a);if(i)return this.queueAccessUpdate(a),i.entry;let n=this.statements.selectById.get(a,s);return n?(this.queueAccessUpdate(a),{key:n.key,namespace:n.namespace,fileName:n.file_name,createdAt:n.created_at,expiresAt:n.expires_at,isDeleted:!!n.is_deleted,lastAccessed:s,dataSize:n.data_size,dataType:n.data_type,isEncryptedNamespace:!!n.is_encrypted_namespace}):null}async getValue(e,t){let s=p(e,t),a=this.getFromHotCache(s);if(a)return this.queueAccessUpdate(s),a.value;let i=await this.get(e,t);if(!i)return null;let n=m(this.cacheDir,i.namespace,i.isEncryptedNamespace),c=l.join(n,i.fileName);if(!await F(c))return await this.delete(e,t),null;let o=await I.readFile(c),d;try{let y=O(o);if(d=y.value,y.usedLegacyKey)try{await x(c,b(d))}catch{}}catch{return await this.delete(e,t),null}return this.addToHotCache(s,d,i),d}async has(e,t){if(!this.isInitialized||!this.statements)return!1;let s=p(e,t);if(this.hotCache.has(s)){let i=this.hotCache.get(s);if(!i.entry.expiresAt||i.entry.expiresAt>Date.now())return!0;this.removeFromHotCache(s)}let a=this.statements.selectById.get(s,Date.now());return a!=null}async delete(e,t){if(!this.isInitialized||!this.statements)return!1;let s=p(e,t);this.removeFromHotCache(s),this.pendingAccessUpdates.delete(s);let a=await this.get(e,t);if(!a)return!1;if(this.options.softDelete)this.statements.softDelete.run(s);else{let i=m(this.cacheDir,a.namespace,a.isEncryptedNamespace),n=l.join(i,a.fileName);await f(n),this.statements.hardDelete.run(s),await E(this.cacheDir,a.namespace,a.isEncryptedNamespace)}return this.emitter.emit("delete",e),!0}async keys(){return!this.isInitialized||!this.statements?[]:this.statements.selectAllKeys.all(Date.now()).map(t=>t.key)}async keysByNamespace(e){return!this.isInitialized||!this.statements?[]:this.statements.selectKeysByNamespace.all(e,Date.now()).map(s=>s.key)}async clear(){if(!(!this.isInitialized||!this.db))if(this.clearHotCache(),this.pendingAccessUpdates.clear(),this.options.softDelete)this.db.exec("UPDATE file_metadata SET is_deleted = 1");else{this.db.exec("DELETE FROM file_metadata");try{await I.rm(this.cacheDir,{recursive:!0,force:!0}),await u(this.cacheDir)}catch{}}}async clearNamespace(e){if(!this.isInitialized||!this.statements||!this.db)return;let t=await this.keysByNamespace(e);for(let a of t){let i=p(a,e);this.removeFromHotCache(i),this.pendingAccessUpdates.delete(i)}let s=this.statements.selectFileInfoByNamespace.all(e);for(let a of s)try{let i=m(this.cacheDir,a.namespace||void 0,!!a.is_encrypted_namespace),n=l.join(i,a.file_name);await f(n)}catch(i){this.options.debug&&console.warn(`Failed to delete file for key ${a.key}:`,i)}this.isBunRuntime()?this.db.prepare("DELETE FROM file_metadata WHERE namespace = ?").run(e):this.db.prepare("DELETE FROM file_metadata WHERE namespace = ?").run(e),await E(this.cacheDir,e,this.options.encryptNamespace);for(let a of t)this.emitter.emit("delete",a)}async getSize(e="active"){if(!this.isInitialized||!this.statements)return 0;let t=Date.now(),s;switch(e){case"active":s=this.statements.countActive.get(t);break;case"deleted":s=this.statements.countDeleted.get();break;case"expired":s=this.statements.countExpired.get(t);break;case"all":s=this.statements.countAll.get();break}return s?.count||0}async clearExpiredEntries(){if(!this.isInitialized||!this.statements)return 0;let e=Date.now(),t=this.statements.selectExpiredEntries.all(e),s=new Set;for(let i of t){let n=p(i.key,i.namespace||void 0);this.removeFromHotCache(n),this.pendingAccessUpdates.delete(n);try{let c=m(this.cacheDir,i.namespace||void 0,!!i.is_encrypted_namespace),o=l.join(c,i.file_name);await f(o),i.namespace&&s.add(i.namespace)}catch(c){this.options.debug&&console.warn(`Failed to delete expired file for key ${i.key}:`,c)}}let a=this.statements.deleteExpired.run(e);for(let i of s)await E(this.cacheDir,i,this.options.encryptNamespace);for(let i of t)this.emitter.emit("expire",i.key);return Number(a.changes||0)}async evictLRUIfNeeded(){if(!this.options.eviction||!this.options.maxItems||!this.statements)return 0;this.flushAccessUpdates();let t=this.statements.countActiveEntries.get().count;if(t<=this.options.maxItems)return 0;let s=t-this.options.maxItems,a=this.statements.selectLRUEntries.all(s),i=new Set,n=0;for(let c of a)try{this.removeFromHotCache(c.id),this.pendingAccessUpdates.delete(c.id);let o=m(this.cacheDir,c.namespace||void 0,!!c.is_encrypted_namespace),d=l.join(o,c.file_name);await f(d),c.namespace&&i.add(c.namespace),this.statements.hardDelete.run(c.id),n++,this.emitter.emit("evict",c.key)}catch(o){this.options.debug&&console.warn(`Failed to evict entry ${c.key}:`,o)}for(let c of i)await E(this.cacheDir,c,this.options.encryptNamespace);return n}async batch(e){if(!this.isInitialized||!this.db)throw new Error("Storage not initialized");if(this.isBunRuntime()){let t=this.db;t.exec("BEGIN IMMEDIATE");try{for(let s of e)s.type==="put"?await this.set(s.key,s.value,s.ttlSeconds,s.namespace):s.type==="del"&&await this.delete(s.key,s.namespace);t.exec("COMMIT")}catch(s){throw t.exec("ROLLBACK"),s}}else{let t=this.db;t.exec("BEGIN IMMEDIATE");try{for(let s of e)s.type==="put"?await this.set(s.key,s.value,s.ttlSeconds,s.namespace):s.type==="del"&&await this.delete(s.key,s.namespace);t.exec("COMMIT")}catch(s){throw t.exec("ROLLBACK"),s}}}getHotCacheStats(){return{size:this.hotCache.size,maxSize:this.maxHotCacheSize,hitRate:0}}getPendingUpdatesCount(){return this.pendingAccessUpdates.size}};var _=class{listeners=new Map;addEventListener(e,t){let s=this.listeners.get(e);return s||(s=new Set,this.listeners.set(e,s)),s.add(t),this}on(e,t){return this.addEventListener(e,t)}removeEventListener(e,t){let s=this.listeners.get(e);if(s){s.delete(t);for(let a of s)a.__once===t&&s.delete(a);s.size===0&&this.listeners.delete(e)}return this}off(e,t){return this.removeEventListener(e,t)}emit(e,...t){let s=this.listeners.get(e);if(!s||s.size===0)return!1;for(let a of[...s])a(...t);return!0}once(e,t){let s=((...a)=>{this.off(e,s),t(...a)});return s.__once=t,this.on(e,s)}listenerCount(e){return this.listeners.get(e)?.size??0}removeAllListeners(e){return e===void 0?this.listeners.clear():this.listeners.delete(e),this}};var A=class r extends _{storageManager;options;isInitialized=!1;evictionTimer;constructor(e={}){super(),this.options={cacheDir:"./cache",encryptNamespace:!1,...e},this.storageManager=new g(this.options,this)}static async create(e={}){let t=new r(e);return await t.initialize(),t}async initialize(){this.isInitialized||(await this.storageManager.initialize(),this.isInitialized=!0,this.options.eviction&&this.options.maxItems&&this.startEvictionTimer(),this.emit("ready"))}startEvictionTimer(){this.evictionTimer&&clearInterval(this.evictionTimer);let e=this.options.evictionInterval||6e4;this.options.eviction&&(this.evictionTimer=setInterval(async()=>{try{await this.storageManager.evictLRUIfNeeded()}catch(t){this.options.debug&&console.warn("LRU eviction failed:",t)}},e),!this.options.keepAlive&&this.evictionTimer.unref&&this.evictionTimer.unref())}async set(e,t,s,a){let i,n;typeof s=="number"?(i=s,n=a):typeof s=="string"&&(n=s),i===void 0&&this.options.ttl&&(i=this.options.ttl),await this.storageManager.set(e,t,i,n),this.emit("set",e,t)}async get(e,t){return await this.storageManager.getValue(e,t)}async has(e,t){return await this.storageManager.has(e,t)}async delete(e,t){if(!this.isInitialized)throw new Error("Cacher not initialized. Use Cacher.create() instead of new Cacher()");return await this.storageManager.delete(e,t)}async keys(e){return e!==void 0?this.storageManager.keysByNamespace(e):await this.storageManager.keys()}async clear(e){if(e!==void 0)return this.storageManager.clearNamespace(e);await this.storageManager.clear()}async size(){return await this.storageManager.getSize()}async clearExpired(){return await this.storageManager.clearExpiredEntries()}async batch(e){await this.storageManager.batch(e)}async getStats(){let e=await this.size(),t=await this.storageManager.getSize("expired"),s=this.storageManager.getHotCacheStats(),a=this.storageManager.getPendingUpdatesCount();return{totalEntries:e,totalSize:e,expiredEntries:t,hotCache:s,pendingUpdates:a}}async close(){this.isInitialized&&(this.evictionTimer&&(clearInterval(this.evictionTimer),this.evictionTimer=void 0),await this.storageManager.close(),this.isInitialized=!1,this.emit("close"))}addEventListener(e,t){return super.addEventListener(e,t)}removeEventListener(e,t){return super.removeEventListener(e,t)}};export{A as Cacher};
