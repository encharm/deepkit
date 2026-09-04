# Serializer + BSON rewrite: consumer migration status

*Updated after the feat/next consumer migration session.*

## Build

`npm run tsc` and `npm run build:esm` both pass — zero errors across all packages.

## Test results

| Package | Result |
|---|---|
| type | 1983 / 1983 |
| type-compiler | 277 / 277 |
| bson | 561 / 561 |
| http | 171 / 171 |
| framework, broker, injector, core, event, workflow, topsort, logger, template, stopwatch | 529 / 529 |
| orm | 46 / 46 |
| rpc | 73 / 73 |
| sql | 12 / 12 |
| mongo | 150 / 157 |
| sqlite | 30 / 32 |

## Remaining

**mongo (5)**
- `log:query`, `log:session` — an enum-valued constructor property on a
  dynamically-built subclass (`LogPlugin.getLogEntity`) comes back `undefined`
  rather than `0`. Reproducing the same shape by hand works, so the cause is
  something about how that entity is built at runtime, not enums or inherited
  constructor properties in general.
- `errors raw`, `errors query` — expected rejections do not fire.
- `company:tableLevelInheritanceBasics`.

**sqlite (2)**
- `joinWith`, `deep join population` — FOREIGN KEY constraint on insert. This
  fails identically on the pre-migration commit, and the unit-of-work topsort
  orders correctly in isolation, so look at how the session batches inserts
  rather than at serialization.

## Root causes fixed (each was breaking many consumers)

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

In `@deepkit/type-compiler`:
12. When a caller passed fewer type arguments than declared, Ω was sized by the
    call site but indexed by the declaration — every MongoDB command serialized
    against `() => any` instead of its message type.

## Watch out

- `getBSONSerializer` returns `[sharedBuffer, size]` — one global buffer reused
  by every serializer. Copy out before the next serialize call.
- `resolvePath` returns the property **member**, not its type. Use
  `serializeProperty(value, member.type, serializer, [schema.type, member])`.
- BSON's hot path is perf-tested. A per-call try/finally or a per-property
  function call is measurable; scope such work to the types that need it.
