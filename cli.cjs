#!/usr/bin/env node
#!/usr/bin/env node
"use strict";var q=Object.create;var N=Object.defineProperty;var X=Object.getOwnPropertyDescriptor;var W=Object.getOwnPropertyNames;var H=Object.getPrototypeOf,j=Object.prototype.hasOwnProperty;var K=(e,t,n,a)=>{if(t&&typeof t=="object"||typeof t=="function")for(let i of W(t))!j.call(e,i)&&i!==n&&N(e,i,{get:()=>t[i],enumerable:!(a=X(t,i))||a.enumerable});return e};var y=(e,t,n)=>(n=e!=null?q(H(e)):{},K(t||!e||!e.__esModule?N(n,"default",{value:e,enumerable:!0}):n,e));var A=y(require("node:path"),1),T=y(require("node:fs"),1);var L="_default";var _=["key","value","created_at","expires_at","is_deleted","last_accessed"];var x="lagr_namespaces",k="lagr_ns_";function E(){return typeof Bun<"u"&&!!Bun?.version}async function M(e){if(E()){let{Database:t}=await import("bun:sqlite");return new t(e)}else{let{DatabaseSync:t}=await import("node:sqlite");return new t(e)}}function d(e,t){e.exec(t)}function S(e,t){return E()?e.query(t).get():e.prepare(t).get()}function I(e,t){return E()?e.query(t).all():e.prepare(t).all()}function P(e){e.close()}function G(e,t,n){return E()?e.query(t).get(...n):e.prepare(t).get(...n)}function C(e,t,n){E()?e.query(t).run(...n):e.prepare(t).run(...n)}function Y(e){let t=new TextEncoder().encode(e),n="";for(let a of t)n+=a.toString(16).padStart(2,"0");return n}function z(e){return e===L?"kv_store":k+Y(e)}function O(e){return`
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
    CREATE TABLE IF NOT EXISTS ${x} (
        name TEXT NOT NULL,
        tbl TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (name)
    ) WITHOUT ROWID;
`;async function v(e){if(!T.default.existsSync(e))return{needsMigration:!1,validation:{isValid:!0,expectedVersion:2,missingColumns:[],extraColumns:[]},dbPath:e,exists:!1};let n=await M(e);try{if(!S(n,"SELECT name FROM sqlite_master WHERE type='table' AND name='kv_store'"))return{needsMigration:!1,validation:{isValid:!0,expectedVersion:2,missingColumns:[],extraColumns:[]},dbPath:e,exists:!0};let r=I(n,"PRAGMA table_info(kv_store)").map(c=>c.name),s;try{let c=["lagr_meta","yq_meta"].find(g=>S(n,`SELECT name FROM sqlite_master WHERE type='table' AND name='${g}'`));if(c){let g=S(n,`SELECT value FROM ${c} WHERE key = 'schema_version'`);g&&(s=parseInt(g.value,10))}}catch{}if(r.includes("namespace"))return{needsMigration:!0,validation:{isValid:!1,currentVersion:s??1,expectedVersion:2,missingColumns:[],extraColumns:["namespace"],message:"v1 layout detected; namespaces move to per-namespace tables in v2"},dbPath:e,exists:!0};let m=[..._],l=m.filter(c=>!r.includes(c)),p=r.filter(c=>!m.includes(c)),o=l.length===0&&(s===void 0||s===2);return{needsMigration:!o,validation:{isValid:o,currentVersion:s,expectedVersion:2,missingColumns:l,extraColumns:p,message:o?void 0:"Schema mismatch detected"},dbPath:e,exists:!0}}finally{P(n)}}async function $(e){let{dbPath:t,backup:n=!0,dryRun:a=!1,verbose:i=!1}=e,r=[],s=f=>{i&&console.log(`[migrate] ${f}`),r.push(f)};if(!T.default.existsSync(t))return{success:!1,fromVersion:null,toVersion:2,changes:["Database file does not exist"],error:`Database file not found: ${t}`};let m=await v(t);if(!m.needsMigration)return s("Schema is already up to date"),{success:!0,fromVersion:m.validation.currentVersion??2,toVersion:2,changes:r};let l=m.validation.currentVersion??0,p;if(n&&!a&&(p=`${t}.backup.${Date.now()}`,T.default.copyFileSync(t,p),s(`Created backup at: ${p}`)),a)return s("DRY RUN - No changes will be made"),s(`Would migrate from v${l} to v${2}`),m.validation.missingColumns.length>0&&s(`Would add columns: ${m.validation.missingColumns.join(", ")}`),{success:!0,fromVersion:l,toVersion:2,changes:r};let o=await M(t);try{if(d(o,"BEGIN TRANSACTION"),m.validation.extraColumns.includes("namespace")){s("Splitting v1 kv_store into per-namespace tables"),d(o,"ALTER TABLE kv_store RENAME TO lagr_migration_v1"),d(o,O("kv_store")),d(o,D);let c=I(o,"SELECT DISTINCT namespace FROM lagr_migration_v1");for(let{namespace:g}of c){let b=z(g);b!=="kv_store"&&(d(o,O(b)),C(o,`INSERT OR IGNORE INTO ${x} (name, tbl, created_at) VALUES (?, ?, ?)`,[g,b,Date.now()]));let B=G(o,"SELECT COUNT(*) as c FROM lagr_migration_v1 WHERE namespace = ?",[g])?.c??0;C(o,`INSERT INTO "${b}" (key, value, created_at, expires_at, is_deleted, last_accessed)
                     SELECT key, value, created_at, expires_at, is_deleted, last_accessed
                     FROM lagr_migration_v1 WHERE namespace = ?`,[g]),s(`Moved namespace "${g}" -> ${b} (${B} rows)`)}d(o,"DROP TABLE lagr_migration_v1")}else{for(let c of m.validation.missingColumns){let g=J(c),b=Q(c);s(`Adding column: ${c} (${b})`),d(o,`ALTER TABLE kv_store ADD COLUMN ${c} ${b} ${g}`)}s("Creating v2 indexes and registry"),d(o,O("kv_store")),d(o,D)}return s("Updating schema version"),d(o,`
            CREATE TABLE IF NOT EXISTS lagr_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `),S(o,"SELECT name FROM sqlite_master WHERE type='table' AND name='yq_meta'")&&(d(o,"INSERT OR IGNORE INTO lagr_meta (key, value) SELECT key, value FROM yq_meta"),d(o,"DROP TABLE yq_meta")),d(o,`INSERT OR REPLACE INTO lagr_meta (key, value) VALUES ('schema_version', '${2}')`),d(o,"COMMIT"),s(`Migration complete: v${l} -> v${2}`),{success:!0,fromVersion:l,toVersion:2,changes:r,backupPath:p}}catch(f){try{d(o,"ROLLBACK")}catch{}let c=f instanceof Error?f.message:String(f);return s(`Migration failed: ${c}`),{success:!1,fromVersion:l,toVersion:2,changes:r,backupPath:p,error:c}}finally{P(o)}}function Q(e){switch(e){case"key":return"TEXT NOT NULL";case"value":return"BLOB NOT NULL";case"created_at":case"expires_at":case"last_accessed":return"INTEGER NOT NULL";case"is_deleted":return"INTEGER NOT NULL";default:return"TEXT"}}function J(e){switch(e){case"expires_at":return`DEFAULT ${9007199254740991}`;case"is_deleted":return"DEFAULT 0";case"last_accessed":return"DEFAULT 0";case"created_at":return`DEFAULT ${Date.now()}`;default:return""}}function V(e,t="*.yqs"){let n=[];if(!T.default.existsSync(e))return n;let a=T.default.readdirSync(e),i=new RegExp("^"+t.replace(/\*/g,".*").replace(/\?/g,".")+"$");for(let r of a)i.test(r)&&n.push(A.default.join(e,r));return n}var h=y(require("node:path"),1),w=y(require("node:os"),1),U=y(require("node:crypto"),1),Z="1.0.0";function ee(){let e=w.default.tmpdir(),t=U.default.createHash("md5").update(process.cwd()).digest("hex")+"_store_storage";return h.default.join(e,`${t}.yqs`)}var te=`
lagr - lagr database management CLI

Usage:
  lagr <command> [options]

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
  lagr check

  # Migrate the default database for current project
  lagr migrate

  # Check a specific database
  lagr check --db ./data/store.yqs

  # Migrate a specific database with backup
  lagr migrate --db ./data/store.yqs --verbose

  # Dry run migration
  lagr migrate --db ./data/store.yqs --dry-run

  # Migrate all databases in a directory
  lagr migrate --dir ./data --pattern "*.yqs" --verbose

  # Skip confirmation
  lagr migrate --db ./data/store.yqs -y
`;function ne(e){let t={command:"",pattern:"*.yqs",backup:!0,dryRun:!1,verbose:!1,yes:!1,json:!1},n=0;for(;n<e.length;){let a=e[n];!a.startsWith("-")&&!t.command?t.command=a:a==="--db"&&n+1<e.length?t.db=e[++n]:a==="--dir"&&n+1<e.length?t.dir=e[++n]:a==="--pattern"&&n+1<e.length?t.pattern=e[++n]:a==="--backup"?t.backup=!0:a==="--no-backup"?t.backup=!1:a==="--dry-run"?t.dryRun=!0:a==="--verbose"||a==="-v"?t.verbose=!0:a==="--yes"||a==="-y"?t.yes=!0:a==="--json"?t.json=!0:a==="--help"||a==="-h"?t.command="help":(a==="--version"||a==="-V")&&(t.command="version"),n++}return t}async function ae(e){let n=(await import("node:readline")).createInterface({input:process.stdin,output:process.stdout});return new Promise(a=>{n.question(`${e} [y/N] `,i=>{n.close(),a(i.toLowerCase()==="y"||i.toLowerCase()==="yes")})})}async function se(e){let t=F(e);!e.db&&!e.dir&&!e.json&&console.log(`Using default database path: ${t[0]}`);let a=[];for(let i of t){let r=await v(i);if(a.push(r),!e.json){if(console.log(""),console.log(`Database: ${i}`),console.log(`  Exists: ${r.exists}`),!r.exists){console.log("  Status: File does not exist");continue}console.log(`  Current Version: ${r.validation.currentVersion??"unknown"}`),console.log(`  Expected Version: ${r.validation.expectedVersion}`),console.log(`  Needs Migration: ${r.needsMigration?"YES":"no"}`),r.validation.missingColumns.length>0&&console.log(`  Missing Columns: ${r.validation.missingColumns.join(", ")}`),r.validation.extraColumns.length>0&&console.log(`  Extra Columns: ${r.validation.extraColumns.join(", ")}`)}}if(e.json)console.log(JSON.stringify(a,null,2));else{console.log("");let i=a.filter(r=>r.needsMigration).length;i>0?(console.log(`
${i} database(s) need migration.`),console.log("Run: lagr migrate --db <path>")):console.log(`
All databases are up to date.`)}}async function re(e){let t=F(e);!e.db&&!e.dir&&console.log(`Using default database path: ${t[0]}`);let a=[];for(let s of t){let m=await v(s);m.needsMigration?a.push({path:s,validation:m.validation}):e.verbose&&console.log(`[skip] ${s} - already up to date`)}if(a.length===0){console.log("All databases are already up to date.");return}console.log(`
Databases to migrate: ${a.length}`);for(let s of a)console.log(`  - ${s.path}`),s.validation.missingColumns.length>0&&console.log(`    Missing columns: ${s.validation.missingColumns.join(", ")}`);if(!e.yes&&!e.dryRun&&!await ae(`
Proceed with migration?`)){console.log("Migration cancelled.");return}let i=0,r=0;for(let s of a){let m={dbPath:s.path,backup:e.backup,dryRun:e.dryRun,verbose:e.verbose};console.log(`
Migrating: ${s.path}`);let l=await $(m);if(l.success){if(i++,e.dryRun?console.log("  [DRY RUN] Would apply changes:"):console.log(`  \u2713 Migrated v${l.fromVersion} -> v${l.toVersion}`),l.backupPath&&console.log(`  Backup: ${l.backupPath}`),e.verbose)for(let p of l.changes)console.log(`    - ${p}`)}else r++,console.log(`  \u2717 Migration failed: ${l.error}`)}console.log(`
`+"\u2500".repeat(50)),console.log(`Migration complete: ${i} succeeded, ${r} failed`)}function F(e){let t=[];if(e.db){let n=h.default.resolve(e.db);t.push(n)}if(e.dir){let n=h.default.resolve(e.dir),a=V(n,e.pattern);t.push(...a)}if(!e.db&&!e.dir){let n=ee();t.push(n)}return t}async function oe(){let e=process.argv.slice(2),t=ne(e);switch(t.command){case"help":case"":console.log(te);break;case"version":console.log(`lagr CLI v${Z}`),console.log(`Schema version: ${2}`);break;case"check":await se(t);break;case"migrate":await re(t);break;default:console.error(`Unknown command: ${t.command}`),console.error('Run "lagr help" for usage information.'),process.exit(1)}}oe().catch(e=>{console.error("Error:",e.message),process.exit(1)});
