/**
 * A tuple field arrives as a BSON array, like an array field does, so the
 * shape JIT reads it through the base deserializer inline instead of keeping
 * the whole shape off the fast path. RPC action bodies are { args: [tuple] }.
 *
 * Run standalone: node --import @deepkit/run --test tests/deserialize/tuple-shape-jit.spec.ts
 */
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { deserializeBSON, getBSONDeserializer, serializeBSON } from '../../index.js';

type Fixed = { args: [number, string] };
type Opt = { args: [number, string?] };
type Nested = { args: [{ id: number; name: string }, boolean] };
type Rest = { args: [string, ...number[]] };
type Dates = { when: Date[]; n: number };
type Mixed = { a: number; args: [number, string]; b: string };
type ArrayBody = { args: (number | string)[] };

function rate(fn: () => void, ms = 300): number {
    for (let i = 0; i < 20_000; i++) fn();
    let ops = 0;
    const end = Date.now() + ms;
    while (Date.now() < end) {
        for (let i = 0; i < 1000; i++) fn();
        ops += 1000;
    }
    return ops / (ms / 1000);
}

test('tuple fields round-trip through the shape JIT', () => {
    expect(deserializeBSON<Fixed>(serializeBSON<Fixed>({ args: [7, 'x'] }))).toEqual({ args: [7, 'x'] });
    expect(deserializeBSON<Opt>(serializeBSON<Opt>({ args: [7, 'x'] }))).toEqual({ args: [7, 'x'] });
    expect(deserializeBSON<Opt>(serializeBSON<Opt>({ args: [7] }))).toEqual({ args: [7] });
    expect(deserializeBSON<Nested>(serializeBSON<Nested>({ args: [{ id: 1, name: 'n' }, true] }))).toEqual({
        args: [{ id: 1, name: 'n' }, true],
    });
    expect(deserializeBSON<Rest>(serializeBSON<Rest>({ args: ['s', 1, 2, 3] }))).toEqual({ args: ['s', 1, 2, 3] });
    //a tuple in the middle: the fields after it must still be read
    expect(deserializeBSON<Mixed>(serializeBSON<Mixed>({ a: 1, args: [2, 'y'], b: 'z' }))).toEqual({
        a: 1,
        args: [2, 'y'],
        b: 'z',
    });
});

test('a required tuple member that is missing still throws', () => {
    expect(() => deserializeBSON<Fixed>(serializeBSON<any>({ args: [7] }))).toThrow();
});

test('an array of a type the shape JIT does not inline reads through the base deserializer', () => {
    //before, such a field compiled to an unconditional BAILOUT
    const r = deserializeBSON<Dates>(serializeBSON<Dates>({ when: [new Date(1000), new Date(2000)], n: 5 }));
    expect(r.when[0]).toBeInstanceOf(Date);
    expect(r.when[1].getTime()).toBe(2000);
    expect(r.n).toBe(5);
});

test('a tuple field deserializes at the rate of an array field', () => {
    const bytes = serializeBSON<Fixed>({ args: [7, 'x'] });
    const tupleField = getBSONDeserializer<Fixed>();
    const arrayField = getBSONDeserializer<ArrayBody>();
    //the two are on the same path now; off it the tuple was well under half
    const ratio = rate(() => tupleField(bytes)) / rate(() => arrayField(bytes));
    expect(ratio).toBeGreaterThan(0.6);
});
