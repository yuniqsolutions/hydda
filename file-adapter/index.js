import h from"node:path";import w from"node:fs/promises";import d from"node:fs/promises";import x from"node:path";import I from"node:crypto";function A(n){return I.createHash("sha256").update(n).digest("hex").substring(0,16)}function S(n){return`${A(n)}.bin`}function l(n,e){return e?`${e}:${n}`:n}function P(n){return n.replace(/[\/\\]/g,"_").replace(/[<>:"|?*]/g,"_").replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i,"$1_").replace(/[. ]+$/,"")||"default"}function p(n,e,s=!1){if(e){let t=s?A(e):P(e);return x.join(n,t)}return n}function D(n){if(Buffer.isBuffer(n))return"buffer";if(Array.isArray(n))return"array";if(typeof n=="string")return"string";if(typeof n=="object"&&n!==null)return"object";if(typeof n=="number"||typeof n=="boolean"||typeof n=="bigint")return"string";throw new Error("Unsupported data type. Only objects, arrays, strings, numbers, booleans, and buffers are supported.")}function N(n){let e=JSON.stringify(n),s=Buffer.from(e,"utf8"),t=Buffer.from("hydda-cache-key","utf8");for(let i=0;i<s.length;i++)s[i]^=t[i%t.length];return s}function R(n){let e=Buffer.from("hydda-cache-key","utf8");for(let t=0;t<n.length;t++)n[t]^=e[t%e.length];let s=n.toString("utf8");return JSON.parse(s)}async function m(n){try{await d.mkdir(n,{recursive:!0})}catch(e){if(e.code!=="EEXIST")throw e}}async function C(n,e){let s=`${n}.tmp`;try{let t=x.dirname(n);await m(t),await d.writeFile(s,e),await d.rename(s,n)}catch(t){try{await d.unlink(s)}catch{}throw t}}async function L(n){try{return await d.access(n),!0}catch{return!1}}async function f(n){try{return await d.unlink(n),!0}catch{return!1}}async function E(n,e,s=!0){if(e)try{let t=p(n,e,s);try{await d.access(t)}catch{return}(await d.readdir(t)).length===0&&await d.rmdir(t)}catch{}}var y=class{db;dbFilePath;cacheDir;isInitialized=!1;options;emitter;statements;hotCache=new Map;hotCacheHead=null;hotCacheTail=null;maxHotCacheSize;pendingAccessUpdates=new Map;accessFlushTimer;accessFlushInterval=1e3;maxPendingUpdates=100;constructor(e,s){this.options={...this.getDefaultOptions(),...e},this.emitter=s,this.cacheDir=this.options.cacheDir||"./cache",this.dbFilePath=h.join(this.cacheDir,"meta.yqc"),this.maxHotCacheSize=this.options.hotCacheSize??1e3}getDefaultOptions(){return{cacheDir:"./cache",ttl:0,eviction:!1,maxItems:1e6,evictionInterval:6e4,softDelete:!0,hotCacheSize:1e3,keepAlive:!1,sqlite:{journalMode:"WAL",synchronous:"NORMAL",cacheSize:-1e5,tempStore:"memory",foreignKeys:!1,busyTimeout:5e3}}}isBunRuntime(){return typeof Bun<"u"&&!!Bun?.version}async initialize(){if(this.isBunRuntime()){if(this.db)return this.db;await m(h.dirname(this.dbFilePath)),await m(this.cacheDir);let{Database:e}=await import("bun:sqlite");return this.db=new e(this.dbFilePath),this.configurePragmas(),this.createTables(),this.prepareStatements(),this.startAccessFlushTimer(),this.isInitialized=!0,this.db}return new Promise(async(e,s)=>{try{await m(h.dirname(this.dbFilePath)),await m(this.cacheDir);let{DatabaseSync:t}=await import("node:sqlite");this.db=new t(this.dbFilePath),this.configurePragmas(),this.createTables(),this.prepareStatements(),this.startAccessFlushTimer(),this.isInitialized=!0,e(this.db)}catch(t){s(t)}})}configurePragmas(){if(!this.db)return;let e=this.options.sqlite||{};this.db.exec(`PRAGMA journal_mode = ${e.journalMode||"WAL"};`),this.db.exec(`PRAGMA synchronous = ${e.synchronous||"NORMAL"};`),this.db.exec(`PRAGMA cache_size = ${e.cacheSize||-1e5};`),this.db.exec(`PRAGMA temp_store = ${e.tempStore||"memory"};`),this.db.exec(`PRAGMA foreign_keys = ${e.foreignKeys?"ON":"OFF"};`),this.db.exec("PRAGMA mmap_size = 268435456;"),this.db.exec("PRAGMA page_size = 4096;"),e.busyTimeout&&this.db.exec(`PRAGMA busy_timeout = ${e.busyTimeout};`)}createTables(){if(!this.db)throw new Error("Database not initialized");this.db.exec(`
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
                `)}}}startAccessFlushTimer(){this.accessFlushTimer&&clearInterval(this.accessFlushTimer),this.accessFlushTimer=setInterval(()=>{this.flushAccessUpdates()},this.accessFlushInterval),!this.options.keepAlive&&this.accessFlushTimer.unref&&this.accessFlushTimer.unref()}flushAccessUpdates(){if(this.pendingAccessUpdates.size===0||!this.db||!this.statements)return;let e=Array.from(this.pendingAccessUpdates.entries());if(this.pendingAccessUpdates.clear(),this.isBunRuntime()){let s=this.db;s.exec("BEGIN IMMEDIATE");try{for(let[t,i]of e)this.statements.batchUpdateAccessed.run(i,t);s.exec("COMMIT")}catch(t){s.exec("ROLLBACK"),this.options.debug&&console.warn("Failed to flush access updates:",t)}}else{let s=this.db;s.exec("BEGIN IMMEDIATE");try{for(let[t,i]of e)this.statements.batchUpdateAccessed.run(i,t);s.exec("COMMIT")}catch(t){s.exec("ROLLBACK"),this.options.debug&&console.warn("Failed to flush access updates:",t)}}}queueAccessUpdate(e){this.pendingAccessUpdates.set(e,Date.now()),this.pendingAccessUpdates.size>=this.maxPendingUpdates&&this.flushAccessUpdates()}addToHotCache(e,s,t){if(this.maxHotCacheSize<=0)return;if(this.hotCache.has(e)){this.moveToFrontOfHotCache(e);let a=this.hotCache.get(e);a.value=s,a.entry=t;return}for(;this.hotCache.size>=this.maxHotCacheSize&&this.hotCacheTail;)this.evictFromHotCache();let i={value:s,entry:t,prev:null,next:this.hotCacheHead};if(this.hotCacheHead){let a=this.hotCache.get(this.hotCacheHead);a&&(a.prev=e)}this.hotCache.set(e,i),this.hotCacheHead=e,this.hotCacheTail||(this.hotCacheTail=e)}getFromHotCache(e){let s=this.hotCache.get(e);return s?s.entry.expiresAt&&s.entry.expiresAt<=Date.now()?(this.removeFromHotCache(e),null):(this.moveToFrontOfHotCache(e),{value:s.value,entry:s.entry}):null}moveToFrontOfHotCache(e){if(this.hotCacheHead===e)return;let s=this.hotCache.get(e);if(s){if(s.prev){let t=this.hotCache.get(s.prev);t&&(t.next=s.next)}if(s.next){let t=this.hotCache.get(s.next);t&&(t.prev=s.prev)}if(this.hotCacheTail===e&&(this.hotCacheTail=s.prev),s.prev=null,s.next=this.hotCacheHead,this.hotCacheHead){let t=this.hotCache.get(this.hotCacheHead);t&&(t.prev=e)}this.hotCacheHead=e}}removeFromHotCache(e){let s=this.hotCache.get(e);if(s){if(s.prev){let t=this.hotCache.get(s.prev);t&&(t.next=s.next)}else this.hotCacheHead=s.next;if(s.next){let t=this.hotCache.get(s.next);t&&(t.prev=s.prev)}else this.hotCacheTail=s.prev;this.hotCache.delete(e)}}evictFromHotCache(){this.hotCacheTail&&this.removeFromHotCache(this.hotCacheTail)}clearHotCache(){this.hotCache.clear(),this.hotCacheHead=null,this.hotCacheTail=null}async close(){if(this.flushAccessUpdates(),this.accessFlushTimer&&(clearInterval(this.accessFlushTimer),this.accessFlushTimer=void 0),this.clearHotCache(),this.isBunRuntime()){if(this.db)try{this.db.close(),this.db=void 0}catch(e){this.options.debug&&console.warn("Warning: Error closing Bun SQLite database:",e),this.db=void 0}this.isInitialized=!1,this.statements=void 0,this.emitter.emit("close");return}return new Promise((e,s)=>{try{this.db&&(this.db.close(),this.db=void 0),this.isInitialized=!1,this.statements=void 0,this.emitter.emit("close"),e()}catch(t){s(t)}})}async set(e,s,t,i){if(!this.isInitialized||!this.statements)throw new Error("Storage not initialized");let a=Date.now(),r=t?a+t*1e3:this.options.ttl?a+this.options.ttl*1e3:null,c=D(s),o=S(e),u=p(this.cacheDir,i,this.options.encryptNamespace),O=h.join(u,o);await m(u);let T=N(s);await C(O,T);let v=l(e,i),b=this.options.encryptNamespace?1:0;this.statements.insertOrReplace.run(v,e,i||null,o,a,r,a,T.length,c,b);let F={key:e,namespace:i,fileName:o,createdAt:a,expiresAt:r??void 0,isDeleted:!1,lastAccessed:a,dataSize:T.length,dataType:c,isEncryptedNamespace:!!b};this.addToHotCache(v,s,F),this.emitter.emit("set",e,s)}async get(e,s){if(!this.isInitialized||!this.statements)return null;let t=Date.now(),i=l(e,s),a=this.getFromHotCache(i);if(a)return this.queueAccessUpdate(i),a.entry;let r=this.statements.selectById.get(i,t);return r?(this.queueAccessUpdate(i),{key:r.key,namespace:r.namespace,fileName:r.file_name,createdAt:r.created_at,expiresAt:r.expires_at,isDeleted:!!r.is_deleted,lastAccessed:t,dataSize:r.data_size,dataType:r.data_type,isEncryptedNamespace:!!r.is_encrypted_namespace}):null}async getValue(e,s){let t=l(e,s),i=this.getFromHotCache(t);if(i)return this.queueAccessUpdate(t),i.value;let a=await this.get(e,s);if(!a)return null;let r=p(this.cacheDir,a.namespace,a.isEncryptedNamespace),c=h.join(r,a.fileName);if(!await L(c))return await this.delete(e,s),null;let o=await w.readFile(c),u=R(o);return this.addToHotCache(t,u,a),u}async has(e,s){if(!this.isInitialized||!this.statements)return!1;let t=l(e,s);if(this.hotCache.has(t)){let a=this.hotCache.get(t);if(!a.entry.expiresAt||a.entry.expiresAt>Date.now())return!0;this.removeFromHotCache(t)}let i=this.statements.selectById.get(t,Date.now());return i!=null}async delete(e,s){if(!this.isInitialized||!this.statements)return!1;let t=l(e,s);this.removeFromHotCache(t),this.pendingAccessUpdates.delete(t);let i=await this.get(e,s);if(!i)return!1;if(this.options.softDelete)this.statements.softDelete.run(t);else{let a=p(this.cacheDir,i.namespace,i.isEncryptedNamespace),r=h.join(a,i.fileName);await f(r),this.statements.hardDelete.run(t),await E(this.cacheDir,i.namespace,i.isEncryptedNamespace)}return this.emitter.emit("delete",e),!0}async keys(){return!this.isInitialized||!this.statements?[]:this.statements.selectAllKeys.all(Date.now()).map(s=>s.key)}async keysByNamespace(e){return!this.isInitialized||!this.statements?[]:this.statements.selectKeysByNamespace.all(e,Date.now()).map(t=>t.key)}async clear(){if(!(!this.isInitialized||!this.db))if(this.clearHotCache(),this.pendingAccessUpdates.clear(),this.options.softDelete)this.db.exec("UPDATE file_metadata SET is_deleted = 1");else{this.db.exec("DELETE FROM file_metadata");try{await w.rm(this.cacheDir,{recursive:!0,force:!0}),await m(this.cacheDir)}catch{}}}async clearNamespace(e){if(!this.isInitialized||!this.statements||!this.db)return;let s=await this.keysByNamespace(e);for(let i of s){let a=l(i,e);this.removeFromHotCache(a),this.pendingAccessUpdates.delete(a)}let t=this.statements.selectFileInfoByNamespace.all(e);for(let i of t)try{let a=p(this.cacheDir,i.namespace||void 0,!!i.is_encrypted_namespace),r=h.join(a,i.file_name);await f(r)}catch(a){this.options.debug&&console.warn(`Failed to delete file for key ${i.key}:`,a)}this.isBunRuntime()?this.db.prepare("DELETE FROM file_metadata WHERE namespace = ?").run(e):this.db.prepare("DELETE FROM file_metadata WHERE namespace = ?").run(e),await E(this.cacheDir,e,this.options.encryptNamespace);for(let i of s)this.emitter.emit("delete",i)}async getSize(e="active"){if(!this.isInitialized||!this.statements)return 0;let s=Date.now(),t;switch(e){case"active":t=this.statements.countActive.get(s);break;case"deleted":t=this.statements.countDeleted.get();break;case"expired":t=this.statements.countExpired.get(s);break;case"all":t=this.statements.countAll.get();break}return t?.count||0}async clearExpiredEntries(){if(!this.isInitialized||!this.statements)return 0;let e=Date.now(),s=this.statements.selectExpiredEntries.all(e),t=new Set;for(let a of s){let r=l(a.key,a.namespace||void 0);this.removeFromHotCache(r),this.pendingAccessUpdates.delete(r);try{let c=p(this.cacheDir,a.namespace||void 0,!!a.is_encrypted_namespace),o=h.join(c,a.file_name);await f(o),a.namespace&&t.add(a.namespace)}catch(c){this.options.debug&&console.warn(`Failed to delete expired file for key ${a.key}:`,c)}}let i=this.statements.deleteExpired.run(e);for(let a of t)await E(this.cacheDir,a,this.options.encryptNamespace);for(let a of s)this.emitter.emit("expire",a.key);return Number(i.changes||0)}async evictLRUIfNeeded(){if(!this.options.eviction||!this.options.maxItems||!this.statements)return 0;this.flushAccessUpdates();let s=this.statements.countActiveEntries.get().count;if(s<=this.options.maxItems)return 0;let t=s-this.options.maxItems,i=this.statements.selectLRUEntries.all(t),a=new Set,r=0;for(let c of i)try{this.removeFromHotCache(c.id),this.pendingAccessUpdates.delete(c.id);let o=p(this.cacheDir,c.namespace||void 0,!!c.is_encrypted_namespace),u=h.join(o,c.file_name);await f(u),c.namespace&&a.add(c.namespace),this.statements.hardDelete.run(c.id),r++,this.emitter.emit("evict",c.key)}catch(o){this.options.debug&&console.warn(`Failed to evict entry ${c.key}:`,o)}for(let c of a)await E(this.cacheDir,c,this.options.encryptNamespace);return r}async batch(e){if(!this.isInitialized||!this.db)throw new Error("Storage not initialized");if(this.isBunRuntime()){let s=this.db;s.exec("BEGIN IMMEDIATE");try{for(let t of e)t.type==="put"?await this.set(t.key,t.value,t.ttlSeconds,t.namespace):t.type==="del"&&await this.delete(t.key,t.namespace);s.exec("COMMIT")}catch(t){throw s.exec("ROLLBACK"),t}}else{let s=this.db;s.exec("BEGIN IMMEDIATE");try{for(let t of e)t.type==="put"?await this.set(t.key,t.value,t.ttlSeconds,t.namespace):t.type==="del"&&await this.delete(t.key,t.namespace);s.exec("COMMIT")}catch(t){throw s.exec("ROLLBACK"),t}}}getHotCacheStats(){return{size:this.hotCache.size,maxSize:this.maxHotCacheSize,hitRate:0}}getPendingUpdatesCount(){return this.pendingAccessUpdates.size}};var g=class{listeners=new Map;addEventListener(e,s){let t=this.listeners.get(e);return t||(t=new Set,this.listeners.set(e,t)),t.add(s),this}on(e,s){return this.addEventListener(e,s)}removeEventListener(e,s){let t=this.listeners.get(e);if(t){t.delete(s);for(let i of t)i.__once===s&&t.delete(i);t.size===0&&this.listeners.delete(e)}return this}off(e,s){return this.removeEventListener(e,s)}emit(e,...s){let t=this.listeners.get(e);if(!t||t.size===0)return!1;for(let i of[...t])i(...s);return!0}once(e,s){let t=((...i)=>{this.off(e,t),s(...i)});return t.__once=s,this.on(e,t)}listenerCount(e){return this.listeners.get(e)?.size??0}removeAllListeners(e){return e===void 0?this.listeners.clear():this.listeners.delete(e),this}};var _=class n extends g{storageManager;options;isInitialized=!1;evictionTimer;constructor(e={}){super(),this.options={cacheDir:"./cache",encryptNamespace:!1,...e},this.storageManager=new y(this.options,this)}static async create(e={}){let s=new n(e);return await s.initialize(),s}async initialize(){this.isInitialized||(await this.storageManager.initialize(),this.isInitialized=!0,this.options.eviction&&this.options.maxItems&&this.startEvictionTimer(),this.emit("ready"))}startEvictionTimer(){this.evictionTimer&&clearInterval(this.evictionTimer);let e=this.options.evictionInterval||6e4;this.options.eviction&&(this.evictionTimer=setInterval(async()=>{try{await this.storageManager.evictLRUIfNeeded()}catch(s){this.options.debug&&console.warn("LRU eviction failed:",s)}},e),!this.options.keepAlive&&this.evictionTimer.unref&&this.evictionTimer.unref())}async set(e,s,t,i){let a,r;typeof t=="number"?(a=t,r=i):typeof t=="string"&&(r=t),a===void 0&&this.options.ttl&&(a=this.options.ttl),await this.storageManager.set(e,s,a,r),this.emit("set",e,s)}async get(e,s){return await this.storageManager.getValue(e,s)}async has(e,s){return await this.storageManager.has(e,s)}async delete(e,s){if(!this.isInitialized)throw new Error("Cacher not initialized. Use Cacher.create() instead of new Cacher()");return await this.storageManager.delete(e,s)}async keys(e){return e!==void 0?this.storageManager.keysByNamespace(e):await this.storageManager.keys()}async clear(e){if(e!==void 0)return this.storageManager.clearNamespace(e);await this.storageManager.clear()}async size(){return await this.storageManager.getSize()}async clearExpired(){return await this.storageManager.clearExpiredEntries()}async batch(e){await this.storageManager.batch(e)}async getStats(){let e=await this.size(),s=await this.storageManager.getSize("expired"),t=this.storageManager.getHotCacheStats(),i=this.storageManager.getPendingUpdatesCount();return{totalEntries:e,totalSize:e,expiredEntries:s,hotCache:t,pendingUpdates:i}}async close(){this.isInitialized&&(this.evictionTimer&&(clearInterval(this.evictionTimer),this.evictionTimer=void 0),await this.storageManager.close(),this.isInitialized=!1,this.emit("close"))}addEventListener(e,s){return super.addEventListener(e,s)}removeEventListener(e,s){return super.removeEventListener(e,s)}};export{_ as Cacher};
