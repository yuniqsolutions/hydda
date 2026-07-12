#!/usr/bin/env node
#!/usr/bin/env node
import U from"node:path";import y from"node:fs";var R="_default";var k=["key","value","created_at","expires_at","is_deleted","last_accessed"];var h="hydda_namespaces",_="hydda_ns_";function T(){return typeof Bun<"u"&&!!Bun?.version}async function O(e){if(T()){let{Database:t}=await import("bun:sqlite");return new t(e)}else{let{DatabaseSync:t}=await import("node:sqlite");return new t(e)}}function d(e,t){e.exec(t)}function E(e,t){return T()?e.query(t).get():e.prepare(t).get()}function A(e,t){return T()?e.query(t).all():e.prepare(t).all()}function L(e){e.close()}function F(e,t,a){return T()?e.query(t).get(...a):e.prepare(t).get(...a)}function C(e,t,a){T()?e.query(t).run(...a):e.prepare(t).run(...a)}function B(e){let t=new TextEncoder().encode(e),a="";for(let n of t)a+=n.toString(16).padStart(2,"0");return a}function W(e){return e===R?"kv_store":_+B(e)}function v(e){return`
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
    `}var D=`
    CREATE TABLE IF NOT EXISTS ${h} (
        name TEXT NOT NULL,
        tbl TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (name)
    ) WITHOUT ROWID;
`;async function S(e){if(!y.existsSync(e))return{needsMigration:!1,validation:{isValid:!0,expectedVersion:2,missingColumns:[],extraColumns:[]},dbPath:e,exists:!1};let a=await O(e);try{if(!E(a,"SELECT name FROM sqlite_master WHERE type='table' AND name='kv_store'"))return{needsMigration:!1,validation:{isValid:!0,expectedVersion:2,missingColumns:[],extraColumns:[]},dbPath:e,exists:!0};let r=A(a,"PRAGMA table_info(kv_store)").map(u=>u.name),s;try{let u=["hydda_meta","yq_meta"].find(f=>E(a,`SELECT name FROM sqlite_master WHERE type='table' AND name='${f}'`));if(u){let f=E(a,`SELECT value FROM ${u} WHERE key = 'schema_version'`);f&&(s=parseInt(f.value,10))}}catch{}if(r.includes("namespace"))return{needsMigration:!0,validation:{isValid:!1,currentVersion:s??1,expectedVersion:2,missingColumns:[],extraColumns:["namespace"],message:"v1 layout detected; namespaces move to per-namespace tables in v2"},dbPath:e,exists:!0};let i=[...k],l=i.filter(u=>!r.includes(u)),g=r.filter(u=>!i.includes(u)),o=l.length===0&&(s===void 0||s===2);return{needsMigration:!o,validation:{isValid:o,currentVersion:s,expectedVersion:2,missingColumns:l,extraColumns:g,message:o?void 0:"Schema mismatch detected"},dbPath:e,exists:!0}}finally{L(a)}}async function M(e){let{dbPath:t,backup:a=!0,dryRun:n=!1,verbose:c=!1}=e,r=[],s=p=>{c&&console.log(`[migrate] ${p}`),r.push(p)};if(!y.existsSync(t))return{success:!1,fromVersion:null,toVersion:2,changes:["Database file does not exist"],error:`Database file not found: ${t}`};let i=await S(t);if(!i.needsMigration)return s("Schema is already up to date"),{success:!0,fromVersion:i.validation.currentVersion??2,toVersion:2,changes:r};let l=i.validation.currentVersion??0,g;if(a&&!n){g=`${t}.backup.${Date.now()}`;try{let p=await O(t);try{d(p,`VACUUM INTO '${g.replace(/'/g,"''")}'`)}finally{L(p)}}catch{y.copyFileSync(t,g);for(let p of["-wal","-shm"])y.existsSync(t+p)&&y.copyFileSync(t+p,g+p)}s(`Created backup at: ${g}`)}if(n)return s("DRY RUN - No changes will be made"),s(`Would migrate from v${l} to v${2}`),i.validation.missingColumns.length>0&&s(`Would add columns: ${i.validation.missingColumns.join(", ")}`),{success:!0,fromVersion:l,toVersion:2,changes:r};let o=await O(t);try{if(d(o,"BEGIN TRANSACTION"),i.validation.extraColumns.includes("namespace")){s("Splitting v1 kv_store into per-namespace tables"),d(o,"ALTER TABLE kv_store RENAME TO hydda_migration_v1"),d(o,v("kv_store")),d(o,D);let u=A(o,"SELECT DISTINCT namespace FROM hydda_migration_v1");for(let{namespace:f}of u){let b=W(f);b!=="kv_store"&&(d(o,v(b)),C(o,`INSERT OR IGNORE INTO ${h} (name, tbl, created_at) VALUES (?, ?, ?)`,[f,b,Date.now()]));let w=F(o,"SELECT COUNT(*) as c FROM hydda_migration_v1 WHERE namespace = ?",[f])?.c??0;C(o,`INSERT INTO "${b}" (key, value, created_at, expires_at, is_deleted, last_accessed)
                     SELECT key, value, created_at, expires_at, is_deleted, last_accessed
                     FROM hydda_migration_v1 WHERE namespace = ?`,[f]),s(`Moved namespace "${f}" -> ${b} (${w} rows)`)}d(o,"DROP TABLE hydda_migration_v1")}else{for(let u of i.validation.missingColumns){let f=X(u),b=q(u);s(`Adding column: ${u} (${b})`),d(o,`ALTER TABLE kv_store ADD COLUMN ${u} ${b} ${f}`)}s("Creating v2 indexes and registry"),d(o,v("kv_store")),d(o,D)}return s("Updating schema version"),d(o,`
            CREATE TABLE IF NOT EXISTS hydda_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `),E(o,"SELECT name FROM sqlite_master WHERE type='table' AND name='yq_meta'")&&(d(o,"INSERT OR IGNORE INTO hydda_meta (key, value) SELECT key, value FROM yq_meta"),d(o,"DROP TABLE yq_meta")),d(o,`INSERT OR REPLACE INTO hydda_meta (key, value) VALUES ('schema_version', '${2}')`),d(o,"COMMIT"),s(`Migration complete: v${l} -> v${2}`),{success:!0,fromVersion:l,toVersion:2,changes:r,backupPath:g}}catch(p){try{d(o,"ROLLBACK")}catch{}let u=p instanceof Error?p.message:String(p);return s(`Migration failed: ${u}`),{success:!1,fromVersion:l,toVersion:2,changes:r,backupPath:g,error:u}}finally{L(o)}}function q(e){switch(e){case"key":return"TEXT NOT NULL";case"value":return"BLOB NOT NULL";case"created_at":case"expires_at":case"last_accessed":return"INTEGER NOT NULL";case"is_deleted":return"INTEGER NOT NULL";default:return"TEXT"}}function X(e){switch(e){case"expires_at":return`DEFAULT ${9007199254740991}`;case"is_deleted":return"DEFAULT 0";case"last_accessed":return"DEFAULT 0";case"created_at":return`DEFAULT ${Date.now()}`;default:return""}}function I(e,t="*.yqs"){let a=[];if(!y.existsSync(e))return a;let n=y.readdirSync(e),c=new RegExp("^"+t.replace(/\*/g,".*").replace(/\?/g,".")+"$");for(let r of n)c.test(r)&&a.push(U.join(e,r));return a}import N from"node:path";import j from"node:os";import H from"node:crypto";var P=Symbol.for("hydda.sqlite-warning-filter");function $(){let e=typeof process<"u"?process:void 0;if(!e||typeof e.emitWarning!="function")return;let t=globalThis;if(t[P])return;t[P]=!0;let a=e.emitWarning;e.emitWarning=function(n,...c){let r=typeof n=="string"?n:n?.message??"",s=typeof n=="object"&&n!==null?n.name:void 0,i=c[0],l=typeof i=="string"?i:i&&typeof i=="object"?i.type:void 0;if(!((s==="ExperimentalWarning"||l==="ExperimentalWarning")&&/sqlite/i.test(String(r))))return a.call(this??e,n,...c)}}$();var K="1.0.0";function G(){let e=j.tmpdir(),t=H.createHash("md5").update(process.cwd()).digest("hex")+"_store_storage";return N.join(e,`${t}.yqs`)}var Y=`
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
`;function z(e){let t={command:"",pattern:"*.yqs",backup:!0,dryRun:!1,verbose:!1,yes:!1,json:!1},a=0;for(;a<e.length;){let n=e[a];!n.startsWith("-")&&!t.command?t.command=n:n==="--db"&&a+1<e.length?t.db=e[++a]:n==="--dir"&&a+1<e.length?t.dir=e[++a]:n==="--pattern"&&a+1<e.length?t.pattern=e[++a]:n==="--backup"?t.backup=!0:n==="--no-backup"?t.backup=!1:n==="--dry-run"?t.dryRun=!0:n==="--verbose"||n==="-v"?t.verbose=!0:n==="--yes"||n==="-y"?t.yes=!0:n==="--json"?t.json=!0:n==="--help"||n==="-h"?t.command="help":(n==="--version"||n==="-V")&&(t.command="version"),a++}return t}async function Q(e){let a=(await import("node:readline")).createInterface({input:process.stdin,output:process.stdout});return new Promise(n=>{a.question(`${e} [y/N] `,c=>{a.close(),n(c.toLowerCase()==="y"||c.toLowerCase()==="yes")})})}async function J(e){let t=V(e);!e.db&&!e.dir&&!e.json&&console.log(`Using default database path: ${t[0]}`);let n=[];for(let c of t){let r=await S(c);if(n.push(r),!e.json){if(console.log(""),console.log(`Database: ${c}`),console.log(`  Exists: ${r.exists}`),!r.exists){console.log("  Status: File does not exist");continue}console.log(`  Current Version: ${r.validation.currentVersion??"unknown"}`),console.log(`  Expected Version: ${r.validation.expectedVersion}`),console.log(`  Needs Migration: ${r.needsMigration?"YES":"no"}`),r.validation.missingColumns.length>0&&console.log(`  Missing Columns: ${r.validation.missingColumns.join(", ")}`),r.validation.extraColumns.length>0&&console.log(`  Extra Columns: ${r.validation.extraColumns.join(", ")}`)}}if(e.json)console.log(JSON.stringify(n,null,2));else{console.log("");let c=n.filter(r=>r.needsMigration).length;c>0?(console.log(`
${c} database(s) need migration.`),console.log("Run: hydda migrate --db <path>")):console.log(`
All databases are up to date.`)}}async function Z(e){let t=V(e);!e.db&&!e.dir&&console.log(`Using default database path: ${t[0]}`);let n=[];for(let s of t){let i=await S(s);i.needsMigration?n.push({path:s,validation:i.validation}):e.verbose&&console.log(`[skip] ${s} - already up to date`)}if(n.length===0){console.log("All databases are already up to date.");return}console.log(`
Databases to migrate: ${n.length}`);for(let s of n)console.log(`  - ${s.path}`),s.validation.missingColumns.length>0&&console.log(`    Missing columns: ${s.validation.missingColumns.join(", ")}`);if(!e.yes&&!e.dryRun&&!await Q(`
Proceed with migration?`)){console.log("Migration cancelled.");return}let c=0,r=0;for(let s of n){let i={dbPath:s.path,backup:e.backup,dryRun:e.dryRun,verbose:e.verbose};console.log(`
Migrating: ${s.path}`);let l=await M(i);if(l.success){if(c++,e.dryRun?console.log("  [DRY RUN] Would apply changes:"):console.log(`  \u2713 Migrated v${l.fromVersion} -> v${l.toVersion}`),l.backupPath&&console.log(`  Backup: ${l.backupPath}`),e.verbose)for(let g of l.changes)console.log(`    - ${g}`)}else r++,console.log(`  \u2717 Migration failed: ${l.error}`)}console.log(`
`+"\u2500".repeat(50)),console.log(`Migration complete: ${c} succeeded, ${r} failed`)}function V(e){let t=[];if(e.db){let a=N.resolve(e.db);t.push(a)}if(e.dir){let a=N.resolve(e.dir),n=I(a,e.pattern);t.push(...n)}if(!e.db&&!e.dir){let a=G();t.push(a)}return t}async function ee(){let e=process.argv.slice(2),t=z(e);switch(t.command){case"help":case"":console.log(Y);break;case"version":console.log(`hydda CLI v${K}`),console.log(`Schema version: ${2}`);break;case"check":await J(t);break;case"migrate":await Z(t);break;default:console.error(`Unknown command: ${t.command}`),console.error('Run "hydda help" for usage information.'),process.exit(1)}}ee().catch(e=>{console.error("Error:",e.message),process.exit(1)});
