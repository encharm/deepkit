# Serializer + BSON rewrite: consumer migration status

## Build

`npm run tsc` and `npm run build:esm` both pass — zero errors across all packages.

## Running the tests

Three packages have migrated from Jest to `node:test`, and Jest cannot parse
their syntax. They are no longer listed as Jest projects:

```
npm run test        # jest packages (accepts a path, e.g. npm run test packages/orm/)
npm run test:node   # type, type-compiler, bson
npm run test:all    # both
```

## Results

Node 24, both runners at once on a machine busy with other work:

| Runner | Result |
|---|---|
| `test:node` (type 1983, type-compiler 277, bson 571) | **2831 pass, 4 skipped** |
| `test` — all 122 jest suites, every database and filesystem adapter | **1461 pass, 2 skipped** |

## Root causes fixed

In `@deepkit/type`:
1. `createSerializeFunction` hardcoded the default serializer, ignoring the
   registry passed — every subclass serializer silently got JSON behaviour.
2. Default handlers were registered in `JSONSerializer`'s constructor rather
   than the base, so `super.registerSerializers()` inherited an empty registry.
3. `register`/`registerClass` appended instead of replacing, against the
   documented contract — subclass handlers chained onto base ones.
4. `setExplicitUndefined` was declared but never called.
5. No handler for member kinds (property/propertySignature/parameter), so an
   HTTP path parameter stayed a string and nothing validated it.
6. An optional primitive property skipped the registry entirely, dropping a
   serializer's own handling of e.g. a UUID.
7. `stringifyType` and `visit` shared `jit.visitStack` but not its id counter.
8. Tuple guards ignored `optional`.
9. `& Inline` was documented but no serializer consulted it.
10. Nested change detectors were held in builder variables and reused across
    branches, so any self-referencing entity threw "fn is not a function".
11. Hooks could not transform the value they passed on.
12. The circular-reference guard pushed but never popped, so a value serialized
    once was treated as circular everywhere it appeared afterwards.
13. `keyof` over a union was `never`, so `Partial<A | B>` had no properties.
14. Loose boolean coercion passed unrecognised values through unchanged.
15. A union's object member was built as a standalone serializer picked at
    runtime, away from its context: SQL stored `{…} | null` columns as raw
    objects (SQLite rejects them), and the caller's options and error path were
    dropped.
16. A constructor property was built without its member, so SQL never saw it as
    an entity column — SQLite returns JSON as text, so it arrived unparsed.
17. `new FastDate()` read the monotonic clock, which drifts from the wall clock.

In `@deepkit/type-compiler`:
18. When a caller passed fewer type arguments than declared, Ω was sized by the
    call site but indexed by the declaration — every MongoDB command serialized
    against `() => any` instead of its message type.

In `@deepkit/bson`:
19. The unrolled document fast path exits early to a slow path returning just
    the value, but an extracted deserializer builds at depth 0 while nested and
    must return `[value, offset]`.
20. Binary in an untyped position was written as `{}`, losing the data.
21. A class deserializer looked for `constructor` among a class's own members,
    so a subclass that declares none lost its base's parameter properties.

Elsewhere: `convertQueryFilter` dropped `{field: undefined}` (soft-delete
matched every row); SQL filter values were serialized without their position, so
a binary UUID column was compared against a string; a reference used as a
primary key returned the raw foreign key; the S3 adapter built keys with a
leading slash so every listing was empty; the SQLite, MySQL and Postgres
unique-constraint check looped forever on a cause that was not `instanceof
Error` (better-sqlite3 raises its binding errors from another realm under Jest),
which hung the whole jest run.

## Watch out

- `getBSONSerializer` returns `[sharedBuffer, size]` — one global buffer reused
  by every serializer. Copy out before the next serialize call.
- `resolvePath` returns the property **member**, not its type. Use
  `serializeProperty(value, member.type, serializer, [schema.type, member])`.
- BSON's hot path is perf-tested. A per-call try/finally or a per-property
  function call is measurable; scope such work to the types that need it.
- `docker compose up -d` publishes alternative ports (postgres 15432, mysql
  13306, mongo 27117, sftp 12022, ftp 12021, …) to avoid clashing with local
  installs. Tests default to those, and never to a database's own default
  port: a local mongo on 27017 belongs to someone else, and the tests drop
  databases. Nothing is published in 10000-10110, where dev servers hand out
  ports.
- Native modules (better-sqlite3) are built for the Node that ran `yarn`. On
  another major, every SQLite test fails with `NODE_MODULE_VERSION`; use that
  Node or `npm rebuild better-sqlite3`.
- The BSON perf-regression ratios compare `hzPeak`, the fastest decile, not the
  mean — the mean moves with whatever else the machine is doing.
