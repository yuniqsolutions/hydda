"use strict";var z=Object.create;var _=Object.defineProperty;var B=Object.getOwnPropertyDescriptor;var W=Object.getOwnPropertyNames;var K=Object.getPrototypeOf,G=Object.prototype.hasOwnProperty;var X=(i,e)=>{for(var t in e)_(i,t,{get:e[t],enumerable:!0})},L=(i,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let a of W(e))!G.call(i,a)&&a!==t&&_(i,a,{get:()=>e[a],enumerable:!(s=B(e,a))||s.enumerable});return i};var f=(i,e,t)=>(t=i!=null?z(K(i)):{},L(e||!i||!i.__esModule?_(t,"default",{value:i,enumerable:!0}):t,i)),j=i=>L(_({},"__esModule",{value:!0}),i);var Y={};X(Y,{Cacher:()=>b});module.exports=j(Y);var h=f(require("node:path"),1),C=f(require("node:fs/promises"),1);var d=f(require("node:fs/promises"),1),S=f(require("node:path"),1),O=f(require("node:crypto"),1);function F(i){return O.default.createHash("sha256").update(i).digest("hex").substring(0,16)}function I(i){return`${F(i)}.bin`}function p(i,e){return e?`${e}:${i}`:i}function $(i){return i.replace(/[\/\\]/g,"_").replace(/[<>:"|?*]/g,"_").replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i,"$1_").replace(/[. ]+$/,"")||"default"}function m(i,e,t=!1){if(e){let s=t?F(e):$(e);return S.default.join(i,s)}return i}function P(i){if(Buffer.isBuffer(i))return"buffer";if(Array.isArray(i))return"array";if(typeof i=="string")return"string";if(typeof i=="object"&&i!==null)return"object";if(typeof i=="number"||typeof i=="boolean"||typeof i=="bigint")return"string";throw new Error("Unsupported data type. Only objects, arrays, strings, numbers, booleans, and buffers are supported.")}var A=Buffer.from("yq-cacher-key-2024","utf8"),q=["hydda-cache-key","lagr-cache-key","kvist-cache-key"].map(i=>Buffer.from(i,"utf8"));function U(i,e){let t=Buffer.from(i);for(let s=0;s<t.length;s++)t[s]^=e[s%e.length];return t}function D(i){let e=JSON.stringify(i);return U(Buffer.from(e,"utf8"),A)}function M(i){for(let t of[A,...q])try{return{value:JSON.parse(U(i,t).toString("utf8")),usedLegacyKey:t!==A}}catch{}let e=new Error("Cache payload could not be decoded with any known key");throw e.code="HYDDA_CACHE_DECODE",e}async function u(i){try{await d.default.mkdir(i,{recursive:!0})}catch(e){if(e.code!=="EEXIST")throw e}}async function N(i,e){let t=`${i}.tmp`;try{let s=S.default.dirname(i);await u(s),await d.default.writeFile(t,e),await d.default.rename(t,i)}catch(s){try{await d.default.unlink(t)}catch{}throw s}}async function k(i){try{return await d.default.access(i),!0}catch{return!1}}async function E(i){try{return await d.default.unlink(i),!0}catch{return!1}}async function y(i,e,t=!0){if(e)try{let s=m(i,e,t);try{await d.default.access(s)}catch{return}(await d.default.readdir(s)).length===0&&await d.default.rmdir(s)}catch{}}var T=class{db;dbFilePath;cacheDir;isInitialized=!1;options;emitter;statements;hotCache=new Map;hotCacheHead=null;hotCacheTail=null;maxHotCacheSize;pendingAccessUpdates=new Map;accessFlushTimer;accessFlushInterval=1e3;maxPendingUpdates=100;constructor(e,t){this.options={...this.getDefaultOptions(),...e},this.emitter=t,this.cacheDir=this.options.cacheDir||"./cache",this.dbFilePath=h.default.join(this.cacheDir,"meta.yqc"),this.maxHotCacheSize=this.options.hotCacheSize??1e3}getDefaultOptions(){return{cacheDir:"./cache",ttl:0,eviction:!1,maxItems:1e6,evictionInterval:6e4,softDelete:!0,hotCacheSize:1e3,keepAlive:!1,sqlite:{journalMode:"WAL",synchronous:"NORMAL",cacheSize:-1e5,tempStore:"memory",foreignKeys:!1,busyTimeout:5e3}}}isBunRuntime(){return typeof Bun<"u"&&!!Bun?.version}async initialize(){if(this.isBunRuntime()){if(this.db)return this.db;await u(h.default.dirname(this.dbFilePath)),await u(this.cacheDir);let{Database:e}=await import("bun:sqlite");return this.db=new e(this.dbFilePath),this.configurePragmas(),this.createTables(),this.prepareStatements(),this.startAccessFlushTimer(),this.isInitialized=!0,this.db}return new Promise(async(e,t)=>{try{await u(h.default.dirname(this.dbFilePath)),await u(this.cacheDir);let{DatabaseSync:s}=await import("node:sqlite");this.db=new s(this.dbFilePath),this.configurePragmas(),this.createTables(),this.prepareStatements(),this.startAccessFlushTimer(),this.isInitialized=!0,e(this.db)}catch(s){t(s)}})}configurePragmas(){if(!this.db)return;let e=this.options.sqlite||{};this.db.exec(`PRAGMA journal_mode = ${e.journalMode||"WAL"};`),this.db.exec(`PRAGMA synchronous = ${e.synchronous||"NORMAL"};`),this.db.exec(`PRAGMA cache_size = ${e.cacheSize||-1e5};`),this.db.exec(`PRAGMA temp_store = ${e.tempStore||"memory"};`),this.db.exec(`PRAGMA foreign_keys = ${e.foreignKeys?"ON":"OFF"};`),this.db.exec("PRAGMA mmap_size = 268435456;"),this.db.exec("PRAGMA page_size = 4096;"),e.busyTimeout&&this.db.exec(`PRAGMA busy_timeout = ${e.busyTimeout};`)}createTables(){if(!this.db)throw new Error("Database not initialized");this.db.exec(`
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
                `)}}}startAccessFlushTimer(){this.accessFlushTimer&&clearInterval(this.accessFlushTimer),this.accessFlushTimer=setInterval(()=>{this.flushAccessUpdates()},this.accessFlushInterval),!this.options.keepAlive&&this.accessFlushTimer.unref&&this.accessFlushTimer.unref()}flushAccessUpdates(){if(this.pendingAccessUpdates.size===0||!this.db||!this.statements)return;let e=Array.from(this.pendingAccessUpdates.entries());if(this.pendingAccessUpdates.clear(),this.isBunRuntime()){let t=this.db;t.exec("BEGIN IMMEDIATE");try{for(let[s,a]of e)this.statements.batchUpdateAccessed.run(a,s);t.exec("COMMIT")}catch(s){t.exec("ROLLBACK"),this.options.debug&&console.warn("Failed to flush access updates:",s)}}else{let t=this.db;t.exec("BEGIN IMMEDIATE");try{for(let[s,a]of e)this.statements.batchUpdateAccessed.run(a,s);t.exec("COMMIT")}catch(s){t.exec("ROLLBACK"),this.options.debug&&console.warn("Failed to flush access updates:",s)}}}queueAccessUpdate(e){this.pendingAccessUpdates.set(e,Date.now()),this.pendingAccessUpdates.size>=this.maxPendingUpdates&&this.flushAccessUpdates()}addToHotCache(e,t,s){if(this.maxHotCacheSize<=0)return;if(this.hotCache.has(e)){this.moveToFrontOfHotCache(e);let r=this.hotCache.get(e);r.value=t,r.entry=s;return}for(;this.hotCache.size>=this.maxHotCacheSize&&this.hotCacheTail;)this.evictFromHotCache();let a={value:t,entry:s,prev:null,next:this.hotCacheHead};if(this.hotCacheHead){let r=this.hotCache.get(this.hotCacheHead);r&&(r.prev=e)}this.hotCache.set(e,a),this.hotCacheHead=e,this.hotCacheTail||(this.hotCacheTail=e)}getFromHotCache(e){let t=this.hotCache.get(e);return t?t.entry.expiresAt&&t.entry.expiresAt<=Date.now()?(this.removeFromHotCache(e),null):(this.moveToFrontOfHotCache(e),{value:t.value,entry:t.entry}):null}moveToFrontOfHotCache(e){if(this.hotCacheHead===e)return;let t=this.hotCache.get(e);if(t){if(t.prev){let s=this.hotCache.get(t.prev);s&&(s.next=t.next)}if(t.next){let s=this.hotCache.get(t.next);s&&(s.prev=t.prev)}if(this.hotCacheTail===e&&(this.hotCacheTail=t.prev),t.prev=null,t.next=this.hotCacheHead,this.hotCacheHead){let s=this.hotCache.get(this.hotCacheHead);s&&(s.prev=e)}this.hotCacheHead=e}}removeFromHotCache(e){let t=this.hotCache.get(e);if(t){if(t.prev){let s=this.hotCache.get(t.prev);s&&(s.next=t.next)}else this.hotCacheHead=t.next;if(t.next){let s=this.hotCache.get(t.next);s&&(s.prev=t.prev)}else this.hotCacheTail=t.prev;this.hotCache.delete(e)}}evictFromHotCache(){this.hotCacheTail&&this.removeFromHotCache(this.hotCacheTail)}clearHotCache(){this.hotCache.clear(),this.hotCacheHead=null,this.hotCacheTail=null}async close(){if(this.flushAccessUpdates(),this.accessFlushTimer&&(clearInterval(this.accessFlushTimer),this.accessFlushTimer=void 0),this.clearHotCache(),this.isBunRuntime()){if(this.db)try{this.db.close(),this.db=void 0}catch(e){this.options.debug&&console.warn("Warning: Error closing Bun SQLite database:",e),this.db=void 0}this.isInitialized=!1,this.statements=void 0,this.emitter.emit("close");return}return new Promise((e,t)=>{try{this.db&&(this.db.close(),this.db=void 0),this.isInitialized=!1,this.statements=void 0,this.emitter.emit("close"),e()}catch(s){t(s)}})}async set(e,t,s,a){if(!this.isInitialized||!this.statements)throw new Error("Storage not initialized");let r=Date.now(),n=s?r+s*1e3:this.options.ttl?r+this.options.ttl*1e3:null,c=P(t),o=I(e),l=m(this.cacheDir,a,this.options.encryptNamespace),g=h.default.join(l,o);await u(l);let x=D(t);await N(g,x);let R=p(e,a),w=this.options.encryptNamespace?1:0;this.statements.insertOrReplace.run(R,e,a||null,o,r,n,r,x.length,c,w);let H={key:e,namespace:a,fileName:o,createdAt:r,expiresAt:n??void 0,isDeleted:!1,lastAccessed:r,dataSize:x.length,dataType:c,isEncryptedNamespace:!!w};this.addToHotCache(R,t,H),this.emitter.emit("set",e,t)}async get(e,t){if(!this.isInitialized||!this.statements)return null;let s=Date.now(),a=p(e,t),r=this.getFromHotCache(a);if(r)return this.queueAccessUpdate(a),r.entry;let n=this.statements.selectById.get(a,s);return n?(this.queueAccessUpdate(a),{key:n.key,namespace:n.namespace,fileName:n.file_name,createdAt:n.created_at,expiresAt:n.expires_at,isDeleted:!!n.is_deleted,lastAccessed:s,dataSize:n.data_size,dataType:n.data_type,isEncryptedNamespace:!!n.is_encrypted_namespace}):null}async getValue(e,t){let s=p(e,t),a=this.getFromHotCache(s);if(a)return this.queueAccessUpdate(s),a.value;let r=await this.get(e,t);if(!r)return null;let n=m(this.cacheDir,r.namespace,r.isEncryptedNamespace),c=h.default.join(n,r.fileName);if(!await k(c))return await this.delete(e,t),null;let o=await C.default.readFile(c),l;try{let g=M(o);if(l=g.value,g.usedLegacyKey)try{await N(c,D(l))}catch{}}catch{return await this.delete(e,t),null}return this.addToHotCache(s,l,r),l}async has(e,t){if(!this.isInitialized||!this.statements)return!1;let s=p(e,t);if(this.hotCache.has(s)){let r=this.hotCache.get(s);if(!r.entry.expiresAt||r.entry.expiresAt>Date.now())return!0;this.removeFromHotCache(s)}let a=this.statements.selectById.get(s,Date.now());return a!=null}async delete(e,t){if(!this.isInitialized||!this.statements)return!1;let s=p(e,t);this.removeFromHotCache(s),this.pendingAccessUpdates.delete(s);let a=await this.get(e,t);if(!a)return!1;if(this.options.softDelete)this.statements.softDelete.run(s);else{let r=m(this.cacheDir,a.namespace,a.isEncryptedNamespace),n=h.default.join(r,a.fileName);await E(n),this.statements.hardDelete.run(s),await y(this.cacheDir,a.namespace,a.isEncryptedNamespace)}return this.emitter.emit("delete",e),!0}async keys(){return!this.isInitialized||!this.statements?[]:this.statements.selectAllKeys.all(Date.now()).map(t=>t.key)}async keysByNamespace(e){return!this.isInitialized||!this.statements?[]:this.statements.selectKeysByNamespace.all(e,Date.now()).map(s=>s.key)}async clear(){if(!(!this.isInitialized||!this.db))if(this.clearHotCache(),this.pendingAccessUpdates.clear(),this.options.softDelete)this.db.exec("UPDATE file_metadata SET is_deleted = 1");else{this.db.exec("DELETE FROM file_metadata");try{await C.default.rm(this.cacheDir,{recursive:!0,force:!0}),await u(this.cacheDir)}catch{}}}async clearNamespace(e){if(!this.isInitialized||!this.statements||!this.db)return;let t=await this.keysByNamespace(e);for(let a of t){let r=p(a,e);this.removeFromHotCache(r),this.pendingAccessUpdates.delete(r)}let s=this.statements.selectFileInfoByNamespace.all(e);for(let a of s)try{let r=m(this.cacheDir,a.namespace||void 0,!!a.is_encrypted_namespace),n=h.default.join(r,a.file_name);await E(n)}catch(r){this.options.debug&&console.warn(`Failed to delete file for key ${a.key}:`,r)}this.isBunRuntime()?this.db.prepare("DELETE FROM file_metadata WHERE namespace = ?").run(e):this.db.prepare("DELETE FROM file_metadata WHERE namespace = ?").run(e),await y(this.cacheDir,e,this.options.encryptNamespace);for(let a of t)this.emitter.emit("delete",a)}async getSize(e="active"){if(!this.isInitialized||!this.statements)return 0;let t=Date.now(),s;switch(e){case"active":s=this.statements.countActive.get(t);break;case"deleted":s=this.statements.countDeleted.get();break;case"expired":s=this.statements.countExpired.get(t);break;case"all":s=this.statements.countAll.get();break}return s?.count||0}async clearExpiredEntries(){if(!this.isInitialized||!this.statements)return 0;let e=Date.now(),t=this.statements.selectExpiredEntries.all(e),s=new Set;for(let r of t){let n=p(r.key,r.namespace||void 0);this.removeFromHotCache(n),this.pendingAccessUpdates.delete(n);try{let c=m(this.cacheDir,r.namespace||void 0,!!r.is_encrypted_namespace),o=h.default.join(c,r.file_name);await E(o),r.namespace&&s.add(r.namespace)}catch(c){this.options.debug&&console.warn(`Failed to delete expired file for key ${r.key}:`,c)}}let a=this.statements.deleteExpired.run(e);for(let r of s)await y(this.cacheDir,r,this.options.encryptNamespace);for(let r of t)this.emitter.emit("expire",r.key);return Number(a.changes||0)}async evictLRUIfNeeded(){if(!this.options.eviction||!this.options.maxItems||!this.statements)return 0;this.flushAccessUpdates();let t=this.statements.countActiveEntries.get().count;if(t<=this.options.maxItems)return 0;let s=t-this.options.maxItems,a=this.statements.selectLRUEntries.all(s),r=new Set,n=0;for(let c of a)try{this.removeFromHotCache(c.id),this.pendingAccessUpdates.delete(c.id);let o=m(this.cacheDir,c.namespace||void 0,!!c.is_encrypted_namespace),l=h.default.join(o,c.file_name);await E(l),c.namespace&&r.add(c.namespace),this.statements.hardDelete.run(c.id),n++,this.emitter.emit("evict",c.key)}catch(o){this.options.debug&&console.warn(`Failed to evict entry ${c.key}:`,o)}for(let c of r)await y(this.cacheDir,c,this.options.encryptNamespace);return n}async batch(e){if(!this.isInitialized||!this.db)throw new Error("Storage not initialized");if(this.isBunRuntime()){let t=this.db;t.exec("BEGIN IMMEDIATE");try{for(let s of e)s.type==="put"?await this.set(s.key,s.value,s.ttlSeconds,s.namespace):s.type==="del"&&await this.delete(s.key,s.namespace);t.exec("COMMIT")}catch(s){throw t.exec("ROLLBACK"),s}}else{let t=this.db;t.exec("BEGIN IMMEDIATE");try{for(let s of e)s.type==="put"?await this.set(s.key,s.value,s.ttlSeconds,s.namespace):s.type==="del"&&await this.delete(s.key,s.namespace);t.exec("COMMIT")}catch(s){throw t.exec("ROLLBACK"),s}}}getHotCacheStats(){return{size:this.hotCache.size,maxSize:this.maxHotCacheSize,hitRate:0}}getPendingUpdatesCount(){return this.pendingAccessUpdates.size}};var v=class{listeners=new Map;addEventListener(e,t){let s=this.listeners.get(e);return s||(s=new Set,this.listeners.set(e,s)),s.add(t),this}on(e,t){return this.addEventListener(e,t)}removeEventListener(e,t){let s=this.listeners.get(e);if(s){s.delete(t);for(let a of s)a.__once===t&&s.delete(a);s.size===0&&this.listeners.delete(e)}return this}off(e,t){return this.removeEventListener(e,t)}emit(e,...t){let s=this.listeners.get(e);if(!s||s.size===0)return!1;for(let a of[...s])a(...t);return!0}once(e,t){let s=((...a)=>{this.off(e,s),t(...a)});return s.__once=t,this.on(e,s)}listenerCount(e){return this.listeners.get(e)?.size??0}removeAllListeners(e){return e===void 0?this.listeners.clear():this.listeners.delete(e),this}};var b=class i extends v{storageManager;options;isInitialized=!1;evictionTimer;constructor(e={}){super(),this.options={cacheDir:"./cache",encryptNamespace:!1,...e},this.storageManager=new T(this.options,this)}static async create(e={}){let t=new i(e);return await t.initialize(),t}async initialize(){this.isInitialized||(await this.storageManager.initialize(),this.isInitialized=!0,this.options.eviction&&this.options.maxItems&&this.startEvictionTimer(),this.emit("ready"))}startEvictionTimer(){this.evictionTimer&&clearInterval(this.evictionTimer);let e=this.options.evictionInterval||6e4;this.options.eviction&&(this.evictionTimer=setInterval(async()=>{try{await this.storageManager.evictLRUIfNeeded()}catch(t){this.options.debug&&console.warn("LRU eviction failed:",t)}},e),!this.options.keepAlive&&this.evictionTimer.unref&&this.evictionTimer.unref())}async set(e,t,s,a){let r,n;typeof s=="number"?(r=s,n=a):typeof s=="string"&&(n=s),r===void 0&&this.options.ttl&&(r=this.options.ttl),await this.storageManager.set(e,t,r,n),this.emit("set",e,t)}async get(e,t){return await this.storageManager.getValue(e,t)}async has(e,t){return await this.storageManager.has(e,t)}async delete(e,t){if(!this.isInitialized)throw new Error("Cacher not initialized. Use Cacher.create() instead of new Cacher()");return await this.storageManager.delete(e,t)}async keys(e){return e!==void 0?this.storageManager.keysByNamespace(e):await this.storageManager.keys()}async clear(e){if(e!==void 0)return this.storageManager.clearNamespace(e);await this.storageManager.clear()}async size(){return await this.storageManager.getSize()}async clearExpired(){return await this.storageManager.clearExpiredEntries()}async batch(e){await this.storageManager.batch(e)}async getStats(){let e=await this.size(),t=await this.storageManager.getSize("expired"),s=this.storageManager.getHotCacheStats(),a=this.storageManager.getPendingUpdatesCount();return{totalEntries:e,totalSize:e,expiredEntries:t,hotCache:s,pendingUpdates:a}}async close(){this.isInitialized&&(this.evictionTimer&&(clearInterval(this.evictionTimer),this.evictionTimer=void 0),await this.storageManager.close(),this.isInitialized=!1,this.emit("close"))}addEventListener(e,t){return super.addEventListener(e,t)}removeEventListener(e,t){return super.removeEventListener(e,t)}};0&&(module.exports={Cacher});
