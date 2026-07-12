# hydda

> **hydda** /ˈhʏdːa/ — *Swedish: hut — the little cabin where your data lives.* A small, sturdy KV store for every JavaScript runtime — Node, Bun, browsers, and React Native. Formerly `yq-store`.

Zero-dependency, embedded, persistent key-value storage with the batteries most apps end up building anyway: namespaces, TTL, type-preserving values, encryption, built-in telemetry, and a full analytics toolkit for product dashboards.

[![npm version](https://img.shields.io/npm/v/hydda.svg)](https://www.npmjs.com/package/hydda)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)](https://nodejs.org/)

```typescript
import { Hydda } from 'hydda';

const store = await Hydda.create();

await store.set('user:1', { name: 'Jo', joined: new Date() }, 3600); // 1h TTL
const user = await store.get('user:1');   // Date comes back as a Date

await store.close();
```

The same class everywhere — bundlers pick the right engine automatically:

```typescript
import { Hydda } from 'hydda';                // Node / Bun / Deno  → SQLite
import { Hydda } from 'hydda/web';            // browsers    → IndexedDB (localStorage fallback)
import { Hydda } from 'hydda/react-native';   // RN          → expo-sqlite & friends
import { Analytics } from 'hydda/analytics';  // dashboards on any of the above
import { Cacher } from 'hydda/file-adapter';  // file-based cache
```

Bare `import { Hydda } from 'hydda'` also resolves per platform (`browser` / `react-native` export conditions), and the root entry additionally exposes `HyddaWeb` / `HyddaRN` for code that needs several platforms at once.

## Why hydda over bare SQLite/IndexedDB

- **Namespaces as physical tables** (Node/Bun): each namespace lives in its own SQLite table behind a registry — writes are ~1.8× faster than a shared table, clearing a namespace is an O(1) `DROP TABLE`, files are ~27% smaller, and global queries merge tables lazily via SQLite's compound-select optimization.
- **Type-preserving values on every platform**: `Date`, `Map`, `Set`, `RegExp`, `BigInt`, typed arrays, `Error` (with `cause`), `URL`, `NaN`/`Infinity`, `undefined` all round-trip. Plain JSON stays plain JSON on disk.
- **TTL done properly**: per-key or default TTL, `ttl()` / `expire()` / `persist()`, lazy cleanup plus periodic sweeps, `NEVER_EXPIRES` sentinel indexing.
- **Soft deletes**: tombstones + compaction, or hard-delete mode.
- **Atomic everything**: `setMany` / `deleteMany` / mixed `batch()` in single transactions, plus a `createTransaction()` builder.
- **Telemetry built in**: latency percentiles per operation, hit rates, per-namespace activity, slow-op capture, Prometheus and OTLP exporters.
- **Analytics built in**: the primitives behind product dashboards — counters, time series, rates, breakdowns, funnels, DAU/WAU/MAU — stored in hydda itself.
- **Safe migrations**: old databases upgrade automatically and atomically on first open; a CLI (`npx hydda migrate`) covers scripted upgrades with backups and progress logs.

## Install

```bash
npm install hydda        # or bun add hydda
```

Node ≥ 22.5 (built-in `node:sqlite`) or any Bun. Browsers need IndexedDB (all evergreen). React Native needs one of `expo-sqlite`, `react-native-sqlite-storage`, or `react-native-sqlite-2`.

## Core API

```typescript
const store = await Hydda.create({
  storage: {
    type: 'persistence',                   // or 'memory'
    persistence: { dbDir: './data', dbFileName: 'app' },
    eviction: true, maxEntries: 100_000,   // LRU eviction
  },
  ttl: 0,                                  // default TTL in seconds (0 = none)
  softDelete: true,
  telemetry: { slowOpThresholdMs: 100 },   // or false to disable
  suppressSQLiteWarning: true,             // opt-in: silence node:sqlite's one-time
                                           // ExperimentalWarning via a narrow filter that
                                           // forwards all other warnings untouched. Off by
                                           // default — hydda never mutates process warning
                                           // behavior unless your app asks (Electron-safe).
});

// CRUD
await store.set('key', value);
await store.set('key', value, 60);                    // TTL seconds
await store.set('key', value, { ttl: 60, namespace: 'users' });
await store.get<T>('key', { namespace: 'users' });
await store.has('key');
await store.delete('key');

// Bulk (single transaction each)
await store.setMany([{ key: 'a', value: 1 }, { key: 'b', value: 2, ttl: 60 }]);
await store.getMany(['a', 'b']);                      // Map<string, T>
await store.deleteMany(['a', 'b']);

// Mixed atomic batch
await store.batch([
  { type: 'put', key: 'x', value: 1, ttl: 60 },
  { type: 'del', key: 'y', namespace: 'other' },
]);

// Listing & search
await store.listKeys({ prefix: 'user:', limit: 100 });
await store.list({ prefix: 'user:', page: 2, limit: 50 });   // or offset / after
await store.forEach((key, value) => {
  if (done) return false;                              // early exit
}, { prefix: 'user:' });
await store.search(/^user:\d+$/);
await store.search('needle', { searchValues: true });
await store.values(); await store.entries();
await store.inspect();                                 // entries WITH metadata

// TTL management
await store.ttl('key');                                // { remaining, expiresAt } | null
await store.expire('key', 7200);
await store.persist('key');

// Counting (prefix/suffix aware)
await store.getSize();                                 // active entries
await store.getSize('deleted', { prefix: 'user:' });
```

Pagination options: `limit` + `offset`, 1-based `page`, or the keyset cursor `after` (stable under concurrent writes — `forEach` uses it internally).

## Namespaces

Logical tables with full isolation — on Node/Bun they are *actual* SQLite tables:

```typescript
const users = store.ns('users');
await users.set('jo', { name: 'Jo' });
await users.search('^j');
await users.getStats();          // { activeCount, deletedCount, expiredCount, sizeBytes }
await users.clear();             // soft: tombstones · hard mode: O(1) DROP TABLE

await store.listNamespaces();
await store.getStats();          // global stats across namespaces
```

Namespace names are arbitrary strings — case-sensitive, any characters.

## Analytics (`hydda/analytics`)

Product-dashboard primitives on top of any hydda store. Buffered writes, TTL-based retention, its own `_analytics` namespace.

```typescript
import { Analytics } from 'hydda/analytics';
const analytics = new Analytics(store);

// record
analytics.increment('emails.delivered', 1, { dimensions: { campaign, sender } });
analytics.record('order.value', 129.99);            // numeric distributions
analytics.time('job.duration', ms);                 // or startTimer()
analytics.track('campaign.run', { name, rate });    // activity feed events
analytics.gauge('accounts.healthy', 2);
analytics.addUnique('contacts', email);
analytics.trackActive('users', userId);             // DAU/WAU/MAU

// query — every widget of a stats page
await analytics.compare('emails.sent', 'today');    // vs yesterday
await analytics.rate('emails.delivered', 'emails.attempted');  // 33.3%
await analytics.series('emails.delivered', { range: '30d' });  // zero-filled chart + peak
await analytics.breakdown('emails.delivered', 'campaign', { top: 5 });
await analytics.stats('order.value', { range: 'month' });      // sum/avg/min/max
await analytics.statsSeries('order.value', { stat: 'sum', interval: 'week' });
await analytics.activeCount('users', { range: '30d' });        // MAU
await analytics.funnel(['visit', 'signup', 'purchase']);
await analytics.recent('campaign.run', { limit: 10 });          // newest first
await analytics.summary('emails.delivered');                    // total + since
await analytics.analyzeNamespace('products');                   // growth of REAL data
analytics.health();                                             // pipeline self-check
```

Ranges: rolling (`'1h'`, `'24h'`, `'7d'`, `'30d'`, `'90d'`, `'365d'`, `{days: n}`), calendar (`'today'`, `'yesterday'`, `'week'`, `'month'`, `'quarter'`, `'year'` — timezone via `utcOffsetMinutes`), `'all'`, `{from, to}`. Dimension cardinality is capped (default 1000 values per dimension) so a stray `userId` dimension can't explode storage.

## Telemetry

Rich observability of the store itself, on by default and O(1) per operation:

```typescript
const snap = store.getTelemetry();
// per-op: count, errors, avg/min/max, p50/p90/p95/p99, items, bytes
// cache hit rate · per-namespace activity · slow-op log · recent errors
// lifecycle: expirations, evictions, tombstones, compactions, migrations
// rolling windows: 1m / 5m / 15m / 1h

store.telemetry.toPrometheus();          // exposition text for /metrics
store.telemetry.toOTLP();                // OTLP/JSON for an OpenTelemetry collector
store.telemetry.mirrorTo(analytics);     // persist op counts → day/month/year queries
```

## Encryption (web)

```typescript
const store = await Hydda.create({
  encryption: { enabled: true, key: 'password', iterations: 210_000 },
});
```

AES-GCM with PBKDF2 key derivation, a distinct key per namespace, and a versioned ciphertext envelope — raising `iterations` later keeps old data readable. Rotate keys in place:

```typescript
await store.rotateEncryption({ key: 'new-password', iterations: 310_000 });
```

## Raw SQL (`store.raw`, Node/Bun)

Full SQL when you need to go beyond key-value — your own tables, joins, indexes — sharing the store's connection and file. One **async, bun:sqlite-flavored API on both runtimes**: on Bun it routes directly to `bun:sqlite`; on Node a thin adapter gives `node:sqlite` the same shape.

```typescript
const raw = store.raw;                 // raw.engine → 'bun' | 'node'

await raw.exec('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, msg TEXT)');
await raw.run('INSERT INTO logs (msg) VALUES (?)', 'hello');

const logs = raw.query('SELECT * FROM logs WHERE id > ?');   // cached statement
await logs.all(0);                     // rows as objects
await logs.get(0);                     // first row, null when none (bun semantics)
await logs.values(0);                  // rows as positional arrays
await raw.prepare('...');              // fresh, uncached statement

const insert = raw.transaction(async (msg) => {   // bun-style factory
  await raw.run('INSERT INTO logs (msg) VALUES (?)', msg);
});
await insert('atomic');                // BEGIN/COMMIT, ROLLBACK on throw
await insert.immediate('locked');      // .deferred / .immediate / .exclusive
                                       // nested transactions become savepoints

for await (const row of logs.iterate(0)) { /* stream large results */ }
raw.query('SELECT * FROM logs').as(LogRow);        // class-mapped rows
raw.prepare('...').safeIntegers();     // bigint reads
await raw.serialize();                 // whole-db snapshot (VACUUM INTO on node)
await raw.checkpoint('TRUNCATE');      // flush WAL
await raw.tables();                    // your tables only
raw.filename; raw.inTransaction;       // properties
```

Connection and database state are store-owned: `PRAGMA` (use `raw.pragma(name)` for reads/diagnostics and `raw.checkpoint()` for WAL), `ATTACH`/`DETACH`, bare `VACUUM` (`VACUUM INTO` snapshots stay allowed), and manual `BEGIN`/`COMMIT`/`SAVEPOINT` (use `raw.transaction()`) are all blocked with pointers to their sanctioned doors. Not part of the API: `loadExtension`, `close()` (the connection's lifetime belongs to `store.close()`), and the bare handles `db.handle` / `statement.native` — they would bypass every guard above.

hydda's internal tables (`kv_store`, `hydda_ns_*`, `hydda_namespaces`, `hydda_meta`) are unreachable through `raw` — reads, writes, and DDL against them throw `HyddaRawAccessError`, and catalog queries (`sqlite_master`, `PRAGMA table_list`) omit them. The guard is a single regex per SQL string; statements then run at native driver speed. Table names starting with `hydda_` are reserved.

## Migration## Migration

Old hydda/yq-store databases upgrade **automatically and atomically** the first time the new version opens them — each namespace's rows move to their own table, the old layout is removed, and a crash mid-migration leaves the original untouched. For scripted upgrades:

```bash
npx hydda check ./data/app.yqs
npx hydda migrate ./data/app.yqs --backup --verbose   # per-namespace progress + row counts
```

## Storage layout (Node/Bun, schema v2)

```
kv_store                      ← default namespace (key-clustered)
hydda_ns_<hex(name)>          ← one table per named namespace
hydda_namespaces              ← name → table registry
hydda_meta                       ← schema version
```

Table names are hex-encoded so any namespace string is a safe, case-sensitive identifier. Global reads (`listKeys()` with no namespace) merge tables with `UNION ALL … ORDER BY key LIMIT`, which SQLite serves by lazily merge-sorting each table's clustered primary key. Web uses one IndexedDB store with a `[namespace, key]` compound key — the same model, expressed natively.

## Events

`ready`, `db:ready`, `set`, `delete`, `expire`, `evict`, `compact:start`, `compact:end`, `migrate`, `error`, `close` — all typed, with `on` / `off` / `once` / `listenerCount`.

## Entry points

| Import | Runtime | Backend |
|---|---|---|
| `hydda` | Node / Bun | `node:sqlite` / `bun:sqlite` |
| `hydda/web` | browsers | IndexedDB, localStorage fallback |
| `hydda/react-native` | React Native | expo-sqlite / rn-sqlite-storage / rn-sqlite-2 |
| `hydda/analytics` | everywhere | any hydda store |
| `hydda/file-adapter` | Node / Bun | SQLite metadata + file blobs |

## License

MIT © [Yuniq Solutions](https://github.com/yuniqsolutions)
