#!/usr/bin/env node
#!/usr/bin/env node
import V from"node:path";import y from"node:fs";var R="_default";var N=["key","value","created_at","expires_at","is_deleted","last_accessed"];var S="hydda_namespaces",L="hydda_ns_";function T(){return typeof Bun<"u"&&!!Bun?.version}async function C(e){if(T()){let{Database:t}=await import("bun:sqlite");return new t(e)}else{let{DatabaseSync:t}=await import("node:sqlite");return new t(e)}}function m(e,t){e.exec(t)}function E(e,t){return T()?e.query(t).get():e.prepare(t).get()}function D(e,t){return T()?e.query(t).all():e.prepare(t).all()}function A(e){e.close()}function w(e,t,n){return T()?e.query(t).get(...n):e.prepare(t).get(...n)}function _(e,t,n){T()?e.query(t).run(...n):e.prepare(t).run(...n)}function U(e){let t=new TextEncoder().encode(e),n="";for(let a of t)n+=a.toString(16).padStart(2,"0");return n}function F(e){return e===R?"kv_store":L+U(e)}function v(e){return`
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
    `}var k=`
    CREATE TABLE IF NOT EXISTS ${S} (
        name TEXT NOT NULL,
        tbl TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (name)
    ) WITHOUT ROWID;
`;async function h(e){if(!y.existsSync(e))return{needsMigration:!1,validation:{isValid:!0,expectedVersion:2,missingColumns:[],extraColumns:[]},dbPath:e,exists:!1};let n=await C(e);try{if(!E(n,"SELECT name FROM sqlite_master WHERE type='table' AND name='kv_store'"))return{needsMigration:!1,validation:{isValid:!0,expectedVersion:2,missingColumns:[],extraColumns:[]},dbPath:e,exists:!0};let r=D(n,"PRAGMA table_info(kv_store)").map(i=>i.name),s;try{let i=["hydda_meta","yq_meta"].find(p=>E(n,`SELECT name FROM sqlite_master WHERE type='table' AND name='${p}'`));if(i){let p=E(n,`SELECT value FROM ${i} WHERE key = 'schema_version'`);p&&(s=parseInt(p.value,10))}}catch{}if(r.includes("namespace"))return{needsMigration:!0,validation:{isValid:!1,currentVersion:s??1,expectedVersion:2,missingColumns:[],extraColumns:["namespace"],message:"v1 layout detected; namespaces move to per-namespace tables in v2"},dbPath:e,exists:!0};let d=[...N],l=d.filter(i=>!r.includes(i)),g=r.filter(i=>!d.includes(i)),o=l.length===0&&(s===void 0||s===2);return{needsMigration:!o,validation:{isValid:o,currentVersion:s,expectedVersion:2,missingColumns:l,extraColumns:g,message:o?void 0:"Schema mismatch detected"},dbPath:e,exists:!0}}finally{A(n)}}async function M(e){let{dbPath:t,backup:n=!0,dryRun:a=!1,verbose:c=!1}=e,r=[],s=f=>{c&&console.log(`[migrate] ${f}`),r.push(f)};if(!y.existsSync(t))return{success:!1,fromVersion:null,toVersion:2,changes:["Database file does not exist"],error:`Database file not found: ${t}`};let d=await h(t);if(!d.needsMigration)return s("Schema is already up to date"),{success:!0,fromVersion:d.validation.currentVersion??2,toVersion:2,changes:r};let l=d.validation.currentVersion??0,g;if(n&&!a&&(g=`${t}.backup.${Date.now()}`,y.copyFileSync(t,g),s(`Created backup at: ${g}`)),a)return s("DRY RUN - No changes will be made"),s(`Would migrate from v${l} to v${2}`),d.validation.missingColumns.length>0&&s(`Would add columns: ${d.validation.missingColumns.join(", ")}`),{success:!0,fromVersion:l,toVersion:2,changes:r};let o=await C(t);try{if(m(o,"BEGIN TRANSACTION"),d.validation.extraColumns.includes("namespace")){s("Splitting v1 kv_store into per-namespace tables"),m(o,"ALTER TABLE kv_store RENAME TO hydda_migration_v1"),m(o,v("kv_store")),m(o,k);let i=D(o,"SELECT DISTINCT namespace FROM hydda_migration_v1");for(let{namespace:p}of i){let b=F(p);b!=="kv_store"&&(m(o,v(b)),_(o,`INSERT OR IGNORE INTO ${S} (name, tbl, created_at) VALUES (?, ?, ?)`,[p,b,Date.now()]));let $=w(o,"SELECT COUNT(*) as c FROM hydda_migration_v1 WHERE namespace = ?",[p])?.c??0;_(o,`INSERT INTO "${b}" (key, value, created_at, expires_at, is_deleted, last_accessed)
                     SELECT key, value, created_at, expires_at, is_deleted, last_accessed
                     FROM hydda_migration_v1 WHERE namespace = ?`,[p]),s(`Moved namespace "${p}" -> ${b} (${$} rows)`)}m(o,"DROP TABLE hydda_migration_v1")}else{for(let i of d.validation.missingColumns){let p=q(i),b=B(i);s(`Adding column: ${i} (${b})`),m(o,`ALTER TABLE kv_store ADD COLUMN ${i} ${b} ${p}`)}s("Creating v2 indexes and registry"),m(o,v("kv_store")),m(o,k)}return s("Updating schema version"),m(o,`
            CREATE TABLE IF NOT EXISTS hydda_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `),E(o,"SELECT name FROM sqlite_master WHERE type='table' AND name='yq_meta'")&&(m(o,"INSERT OR IGNORE INTO hydda_meta (key, value) SELECT key, value FROM yq_meta"),m(o,"DROP TABLE yq_meta")),m(o,`INSERT OR REPLACE INTO hydda_meta (key, value) VALUES ('schema_version', '${2}')`),m(o,"COMMIT"),s(`Migration complete: v${l} -> v${2}`),{success:!0,fromVersion:l,toVersion:2,changes:r,backupPath:g}}catch(f){try{m(o,"ROLLBACK")}catch{}let i=f instanceof Error?f.message:String(f);return s(`Migration failed: ${i}`),{success:!1,fromVersion:l,toVersion:2,changes:r,backupPath:g,error:i}}finally{A(o)}}function B(e){switch(e){case"key":return"TEXT NOT NULL";case"value":return"BLOB NOT NULL";case"created_at":case"expires_at":case"last_accessed":return"INTEGER NOT NULL";case"is_deleted":return"INTEGER NOT NULL";default:return"TEXT"}}function q(e){switch(e){case"expires_at":return`DEFAULT ${9007199254740991}`;case"is_deleted":return"DEFAULT 0";case"last_accessed":return"DEFAULT 0";case"created_at":return`DEFAULT ${Date.now()}`;default:return""}}function I(e,t="*.yqs"){let n=[];if(!y.existsSync(e))return n;let a=y.readdirSync(e),c=new RegExp("^"+t.replace(/\*/g,".*").replace(/\?/g,".")+"$");for(let r of a)c.test(r)&&n.push(V.join(e,r));return n}import O from"node:path";import X from"node:os";import W from"node:crypto";var H="1.0.0";function j(){let e=X.tmpdir(),t=W.createHash("md5").update(process.cwd()).digest("hex")+"_store_storage";return O.join(e,`${t}.yqs`)}var K=`
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
`;function G(e){let t={command:"",pattern:"*.yqs",backup:!0,dryRun:!1,verbose:!1,yes:!1,json:!1},n=0;for(;n<e.length;){let a=e[n];!a.startsWith("-")&&!t.command?t.command=a:a==="--db"&&n+1<e.length?t.db=e[++n]:a==="--dir"&&n+1<e.length?t.dir=e[++n]:a==="--pattern"&&n+1<e.length?t.pattern=e[++n]:a==="--backup"?t.backup=!0:a==="--no-backup"?t.backup=!1:a==="--dry-run"?t.dryRun=!0:a==="--verbose"||a==="-v"?t.verbose=!0:a==="--yes"||a==="-y"?t.yes=!0:a==="--json"?t.json=!0:a==="--help"||a==="-h"?t.command="help":(a==="--version"||a==="-V")&&(t.command="version"),n++}return t}async function Y(e){let n=(await import("node:readline")).createInterface({input:process.stdin,output:process.stdout});return new Promise(a=>{n.question(`${e} [y/N] `,c=>{n.close(),a(c.toLowerCase()==="y"||c.toLowerCase()==="yes")})})}async function z(e){let t=P(e);!e.db&&!e.dir&&!e.json&&console.log(`Using default database path: ${t[0]}`);let a=[];for(let c of t){let r=await h(c);if(a.push(r),!e.json){if(console.log(""),console.log(`Database: ${c}`),console.log(`  Exists: ${r.exists}`),!r.exists){console.log("  Status: File does not exist");continue}console.log(`  Current Version: ${r.validation.currentVersion??"unknown"}`),console.log(`  Expected Version: ${r.validation.expectedVersion}`),console.log(`  Needs Migration: ${r.needsMigration?"YES":"no"}`),r.validation.missingColumns.length>0&&console.log(`  Missing Columns: ${r.validation.missingColumns.join(", ")}`),r.validation.extraColumns.length>0&&console.log(`  Extra Columns: ${r.validation.extraColumns.join(", ")}`)}}if(e.json)console.log(JSON.stringify(a,null,2));else{console.log("");let c=a.filter(r=>r.needsMigration).length;c>0?(console.log(`
${c} database(s) need migration.`),console.log("Run: hydda migrate --db <path>")):console.log(`
All databases are up to date.`)}}async function Q(e){let t=P(e);!e.db&&!e.dir&&console.log(`Using default database path: ${t[0]}`);let a=[];for(let s of t){let d=await h(s);d.needsMigration?a.push({path:s,validation:d.validation}):e.verbose&&console.log(`[skip] ${s} - already up to date`)}if(a.length===0){console.log("All databases are already up to date.");return}console.log(`
Databases to migrate: ${a.length}`);for(let s of a)console.log(`  - ${s.path}`),s.validation.missingColumns.length>0&&console.log(`    Missing columns: ${s.validation.missingColumns.join(", ")}`);if(!e.yes&&!e.dryRun&&!await Y(`
Proceed with migration?`)){console.log("Migration cancelled.");return}let c=0,r=0;for(let s of a){let d={dbPath:s.path,backup:e.backup,dryRun:e.dryRun,verbose:e.verbose};console.log(`
Migrating: ${s.path}`);let l=await M(d);if(l.success){if(c++,e.dryRun?console.log("  [DRY RUN] Would apply changes:"):console.log(`  \u2713 Migrated v${l.fromVersion} -> v${l.toVersion}`),l.backupPath&&console.log(`  Backup: ${l.backupPath}`),e.verbose)for(let g of l.changes)console.log(`    - ${g}`)}else r++,console.log(`  \u2717 Migration failed: ${l.error}`)}console.log(`
`+"\u2500".repeat(50)),console.log(`Migration complete: ${c} succeeded, ${r} failed`)}function P(e){let t=[];if(e.db){let n=O.resolve(e.db);t.push(n)}if(e.dir){let n=O.resolve(e.dir),a=I(n,e.pattern);t.push(...a)}if(!e.db&&!e.dir){let n=j();t.push(n)}return t}async function J(){let e=process.argv.slice(2),t=G(e);switch(t.command){case"help":case"":console.log(K);break;case"version":console.log(`hydda CLI v${H}`),console.log(`Schema version: ${2}`);break;case"check":await z(t);break;case"migrate":await Q(t);break;default:console.error(`Unknown command: ${t.command}`),console.error('Run "hydda help" for usage information.'),process.exit(1)}}J().catch(e=>{console.error("Error:",e.message),process.exit(1)});
