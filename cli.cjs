#!/usr/bin/env node
#!/usr/bin/env node
"use strict";var X=Object.create;var k=Object.defineProperty;var j=Object.getOwnPropertyDescriptor;var H=Object.getOwnPropertyNames;var K=Object.getPrototypeOf,G=Object.prototype.hasOwnProperty;var Y=(e,t,a,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of H(t))!G.call(e,o)&&o!==a&&k(e,o,{get:()=>t[o],enumerable:!(n=j(t,o))||n.enumerable});return e};var y=(e,t,a)=>(a=e!=null?X(K(e)):{},Y(t||!e||!e.__esModule?k(a,"default",{value:e,enumerable:!0}):a,e));var I=y(require("node:path"),1),T=y(require("node:fs"),1);var _="_default";var C=["key","value","created_at","expires_at","is_deleted","last_accessed"];var x="hydda_namespaces",D="hydda_ns_";function E(){return typeof Bun<"u"&&!!Bun?.version}async function N(e){if(E()){let{Database:t}=await import("bun:sqlite");return new t(e)}else{let{DatabaseSync:t}=await import("node:sqlite");return new t(e)}}function d(e,t){e.exec(t)}function S(e,t){return E()?e.query(t).get():e.prepare(t).get()}function P(e,t){return E()?e.query(t).all():e.prepare(t).all()}function R(e){e.close()}function z(e,t,a){return E()?e.query(t).get(...a):e.prepare(t).get(...a)}function A(e,t,a){E()?e.query(t).run(...a):e.prepare(t).run(...a)}function Q(e){let t=new TextEncoder().encode(e),a="";for(let n of t)a+=n.toString(16).padStart(2,"0");return a}function J(e){return e===_?"kv_store":D+Q(e)}function O(e){return`
        CREATE TABLE IF NOT EXISTS "${e}" (
            key TEXT NOT NULL,
            value BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL DEFAULT ${9007199254740991},
            is_deleted INTEGER NOT NULL DEFAULT 0,
            last_accessed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (key)
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS "idx_${e}_expiry"
            ON "${e}"(expires_at)
            WHERE is_deleted = 0 AND expires_at < ${9007199254740991};

        CREATE INDEX IF NOT EXISTS "idx_${e}_lru"
            ON "${e}"(last_accessed)
            WHERE is_deleted = 0;
    `}var M=`
    CREATE TABLE IF NOT EXISTS ${x} (
        name TEXT NOT NULL,
        tbl TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (name)
    ) WITHOUT ROWID;
`;async function h(e){if(!T.default.existsSync(e))return{needsMigration:!1,validation:{isValid:!0,expectedVersion:2,missingColumns:[],extraColumns:[]},dbPath:e,exists:!1};let a=await N(e);try{if(!S(a,"SELECT name FROM sqlite_master WHERE type='table' AND name='kv_store'"))return{needsMigration:!1,validation:{isValid:!0,expectedVersion:2,missingColumns:[],extraColumns:[]},dbPath:e,exists:!0};let r=P(a,"PRAGMA table_info(kv_store)").map(u=>u.name),s;try{let u=["hydda_meta","yq_meta"].find(f=>S(a,`SELECT name FROM sqlite_master WHERE type='table' AND name='${f}'`));if(u){let f=S(a,`SELECT value FROM ${u} WHERE key = 'schema_version'`);f&&(s=parseInt(f.value,10))}}catch{}if(r.includes("namespace"))return{needsMigration:!0,validation:{isValid:!1,currentVersion:s??1,expectedVersion:2,missingColumns:[],extraColumns:["namespace"],message:"v1 layout detected; namespaces move to per-namespace tables in v2"},dbPath:e,exists:!0};let c=[...C],l=c.filter(u=>!r.includes(u)),g=r.filter(u=>!c.includes(u)),i=l.length===0&&(s===void 0||s===2);return{needsMigration:!i,validation:{isValid:i,currentVersion:s,expectedVersion:2,missingColumns:l,extraColumns:g,message:i?void 0:"Schema mismatch detected"},dbPath:e,exists:!0}}finally{R(a)}}async function $(e){let{dbPath:t,backup:a=!0,dryRun:n=!1,verbose:o=!1}=e,r=[],s=p=>{o&&console.log(`[migrate] ${p}`),r.push(p)};if(!T.default.existsSync(t))return{success:!1,fromVersion:null,toVersion:2,changes:["Database file does not exist"],error:`Database file not found: ${t}`};let c=await h(t);if(!c.needsMigration)return s("Schema is already up to date"),{success:!0,fromVersion:c.validation.currentVersion??2,toVersion:2,changes:r};let l=c.validation.currentVersion??0,g;if(a&&!n){g=`${t}.backup.${Date.now()}`;try{let p=await N(t);try{d(p,`VACUUM INTO '${g.replace(/'/g,"''")}'`)}finally{R(p)}}catch{T.default.copyFileSync(t,g);for(let p of["-wal","-shm"])T.default.existsSync(t+p)&&T.default.copyFileSync(t+p,g+p)}s(`Created backup at: ${g}`)}if(n)return s("DRY RUN - No changes will be made"),s(`Would migrate from v${l} to v${2}`),c.validation.missingColumns.length>0&&s(`Would add columns: ${c.validation.missingColumns.join(", ")}`),{success:!0,fromVersion:l,toVersion:2,changes:r};let i=await N(t);try{if(d(i,"BEGIN TRANSACTION"),c.validation.extraColumns.includes("namespace")){s("Splitting v1 kv_store into per-namespace tables"),d(i,"ALTER TABLE kv_store RENAME TO hydda_migration_v1"),d(i,O("kv_store")),d(i,M);let u=P(i,"SELECT DISTINCT namespace FROM hydda_migration_v1");for(let{namespace:f}of u){let b=J(f);b!=="kv_store"&&(d(i,O(b)),A(i,`INSERT OR IGNORE INTO ${x} (name, tbl, created_at) VALUES (?, ?, ?)`,[f,b,Date.now()]));let q=z(i,"SELECT COUNT(*) as c FROM hydda_migration_v1 WHERE namespace = ?",[f])?.c??0;A(i,`INSERT INTO "${b}" (key, value, created_at, expires_at, is_deleted, last_accessed)
                     SELECT key, value, created_at, expires_at, is_deleted, last_accessed
                     FROM hydda_migration_v1 WHERE namespace = ?`,[f]),s(`Moved namespace "${f}" -> ${b} (${q} rows)`)}d(i,"DROP TABLE hydda_migration_v1")}else{for(let u of c.validation.missingColumns){let f=ee(u),b=Z(u);s(`Adding column: ${u} (${b})`),d(i,`ALTER TABLE kv_store ADD COLUMN ${u} ${b} ${f}`)}s("Creating v2 indexes and registry"),d(i,O("kv_store")),d(i,M)}return s("Updating schema version"),d(i,`
            CREATE TABLE IF NOT EXISTS hydda_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `),S(i,"SELECT name FROM sqlite_master WHERE type='table' AND name='yq_meta'")&&(d(i,"INSERT OR IGNORE INTO hydda_meta (key, value) SELECT key, value FROM yq_meta"),d(i,"DROP TABLE yq_meta")),d(i,`INSERT OR REPLACE INTO hydda_meta (key, value) VALUES ('schema_version', '${2}')`),d(i,"COMMIT"),s(`Migration complete: v${l} -> v${2}`),{success:!0,fromVersion:l,toVersion:2,changes:r,backupPath:g}}catch(p){try{d(i,"ROLLBACK")}catch{}let u=p instanceof Error?p.message:String(p);return s(`Migration failed: ${u}`),{success:!1,fromVersion:l,toVersion:2,changes:r,backupPath:g,error:u}}finally{R(i)}}function Z(e){switch(e){case"key":return"TEXT NOT NULL";case"value":return"BLOB NOT NULL";case"created_at":case"expires_at":case"last_accessed":return"INTEGER NOT NULL";case"is_deleted":return"INTEGER NOT NULL";default:return"TEXT"}}function ee(e){switch(e){case"expires_at":return`DEFAULT ${9007199254740991}`;case"is_deleted":return"DEFAULT 0";case"last_accessed":return"DEFAULT 0";case"created_at":return`DEFAULT ${Date.now()}`;default:return""}}function V(e,t="*.yqs"){let a=[];if(!T.default.existsSync(e))return a;let n=T.default.readdirSync(e),o=new RegExp("^"+t.replace(/\*/g,".*").replace(/\?/g,".")+"$");for(let r of n)o.test(r)&&a.push(I.default.join(e,r));return a}var v=y(require("node:path"),1),F=y(require("node:os"),1),B=y(require("node:crypto"),1);var w=Symbol.for("hydda.sqlite-warning-filter");function U(){let e=typeof process<"u"?process:void 0;if(!e||typeof e.emitWarning!="function")return;let t=globalThis;if(t[w])return;t[w]=!0;let a=e.emitWarning;e.emitWarning=function(n,...o){let r=typeof n=="string"?n:n?.message??"",s=typeof n=="object"&&n!==null?n.name:void 0,c=o[0],l=typeof c=="string"?c:c&&typeof c=="object"?c.type:void 0;if(!((s==="ExperimentalWarning"||l==="ExperimentalWarning")&&/sqlite/i.test(String(r))))return a.call(this??e,n,...o)}}U();var te="1.0.0";function ne(){let e=F.default.tmpdir(),t=B.default.createHash("md5").update(process.cwd()).digest("hex")+"_store_storage";return v.default.join(e,`${t}.yqs`)}var ae=`
hydda - hydda database management CLI

Usage:
  hydda <command> [options]

Commands:
  migrate     Migrate database schema to the latest version
  check       Check if database needs migration
  version     Show version information
  help        Show this help message

Options for 'migrate':
  --db <path>       Path to database file (uses default if not specified)
  --dir <path>      Directory containing database files
  --pattern <glob>  Pattern for finding databases (default: *.yqs)
  --backup          Create backup before migration (default: true)
  --no-backup       Skip backup creation
  --dry-run         Preview changes without applying them
  --verbose, -v     Show detailed output
  --yes, -y         Skip confirmation prompts

Options for 'check':
  --db <path>       Path to database file (uses default if not specified)
  --dir <path>      Directory containing database files
  --pattern <glob>  Pattern for finding databases (default: *.yqs)
  --json            Output result as JSON

Examples:
  # Check the default database for current project
  hydda check

  # Migrate the default database for current project
  hydda migrate

  # Check a specific database
  hydda check --db ./data/store.yqs

  # Migrate a specific database with backup
  hydda migrate --db ./data/store.yqs --verbose

  # Dry run migration
  hydda migrate --db ./data/store.yqs --dry-run

  # Migrate all databases in a directory
  hydda migrate --dir ./data --pattern "*.yqs" --verbose

  # Skip confirmation
  hydda migrate --db ./data/store.yqs -y
`;function se(e){let t={command:"",pattern:"*.yqs",backup:!0,dryRun:!1,verbose:!1,yes:!1,json:!1},a=0;for(;a<e.length;){let n=e[a];!n.startsWith("-")&&!t.command?t.command=n:n==="--db"&&a+1<e.length?t.db=e[++a]:n==="--dir"&&a+1<e.length?t.dir=e[++a]:n==="--pattern"&&a+1<e.length?t.pattern=e[++a]:n==="--backup"?t.backup=!0:n==="--no-backup"?t.backup=!1:n==="--dry-run"?t.dryRun=!0:n==="--verbose"||n==="-v"?t.verbose=!0:n==="--yes"||n==="-y"?t.yes=!0:n==="--json"?t.json=!0:n==="--help"||n==="-h"?t.command="help":(n==="--version"||n==="-V")&&(t.command="version"),a++}return t}async function re(e){let a=(await import("node:readline")).createInterface({input:process.stdin,output:process.stdout});return new Promise(n=>{a.question(`${e} [y/N] `,o=>{a.close(),n(o.toLowerCase()==="y"||o.toLowerCase()==="yes")})})}async function oe(e){let t=W(e);!e.db&&!e.dir&&!e.json&&console.log(`Using default database path: ${t[0]}`);let n=[];for(let o of t){let r=await h(o);if(n.push(r),!e.json){if(console.log(""),console.log(`Database: ${o}`),console.log(`  Exists: ${r.exists}`),!r.exists){console.log("  Status: File does not exist");continue}console.log(`  Current Version: ${r.validation.currentVersion??"unknown"}`),console.log(`  Expected Version: ${r.validation.expectedVersion}`),console.log(`  Needs Migration: ${r.needsMigration?"YES":"no"}`),r.validation.missingColumns.length>0&&console.log(`  Missing Columns: ${r.validation.missingColumns.join(", ")}`),r.validation.extraColumns.length>0&&console.log(`  Extra Columns: ${r.validation.extraColumns.join(", ")}`)}}if(e.json)console.log(JSON.stringify(n,null,2));else{console.log("");let o=n.filter(r=>r.needsMigration).length;o>0?(console.log(`
${o} database(s) need migration.`),console.log("Run: hydda migrate --db <path>")):console.log(`
All databases are up to date.`)}}async function ie(e){let t=W(e);!e.db&&!e.dir&&console.log(`Using default database path: ${t[0]}`);let n=[];for(let s of t){let c=await h(s);c.needsMigration?n.push({path:s,validation:c.validation}):e.verbose&&console.log(`[skip] ${s} - already up to date`)}if(n.length===0){console.log("All databases are already up to date.");return}console.log(`
Databases to migrate: ${n.length}`);for(let s of n)console.log(`  - ${s.path}`),s.validation.missingColumns.length>0&&console.log(`    Missing columns: ${s.validation.missingColumns.join(", ")}`);if(!e.yes&&!e.dryRun&&!await re(`
Proceed with migration?`)){console.log("Migration cancelled.");return}let o=0,r=0;for(let s of n){let c={dbPath:s.path,backup:e.backup,dryRun:e.dryRun,verbose:e.verbose};console.log(`
Migrating: ${s.path}`);let l=await $(c);if(l.success){if(o++,e.dryRun?console.log("  [DRY RUN] Would apply changes:"):console.log(`  \u2713 Migrated v${l.fromVersion} -> v${l.toVersion}`),l.backupPath&&console.log(`  Backup: ${l.backupPath}`),e.verbose)for(let g of l.changes)console.log(`    - ${g}`)}else r++,console.log(`  \u2717 Migration failed: ${l.error}`)}console.log(`
`+"\u2500".repeat(50)),console.log(`Migration complete: ${o} succeeded, ${r} failed`)}function W(e){let t=[];if(e.db){let a=v.default.resolve(e.db);t.push(a)}if(e.dir){let a=v.default.resolve(e.dir),n=V(a,e.pattern);t.push(...n)}if(!e.db&&!e.dir){let a=ne();t.push(a)}return t}async function ce(){let e=process.argv.slice(2),t=se(e);switch(t.command){case"help":case"":console.log(ae);break;case"version":console.log(`hydda CLI v${te}`),console.log(`Schema version: ${2}`);break;case"check":await oe(t);break;case"migrate":await ie(t);break;default:console.error(`Unknown command: ${t.command}`),console.error('Run "hydda help" for usage information.'),process.exit(1)}}ce().catch(e=>{console.error("Error:",e.message),process.exit(1)});
