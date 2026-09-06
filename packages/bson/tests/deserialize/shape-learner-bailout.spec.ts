/**
 * A top-level shape the JIT cannot build (a tuple field, for one) must be
 * remembered as unlearnable. Without that the learner never graduates:
 * learnShape + buildShapeJit run on every call before the slow path does the
 * work. RPC action bodies are { args: [tuple] }, so every RPC call paid for it.
 *
 * Run standalone: node --import @deepkit/run --test tests/deserialize/shape-learner-bailout.spec.ts
 */
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { getBSONDeserializer, serializeBSON } from '../../index.js';

type TupleBody = { args: [number, string] };
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

test('an unlearnable top-level shape is not re-learned on every call', () => {
    const bytes = serializeBSON<TupleBody>({ args: [7, 'x'] });
    const tupleField = getBSONDeserializer<TupleBody>();
    const arrayField = getBSONDeserializer<ArrayBody>();

    expect(tupleField(bytes)).toEqual({ args: [7, 'x'] });
    expect(arrayField(bytes)).toEqual({ args: [7, 'x'] });

    //the tuple field takes the slow path; the array field is shape-JITed.
    //Re-learning per call put the slow path at ~1% of the JIT rate; taking
    //it once leaves the two within the same order of magnitude
    const ratio = rate(() => tupleField(bytes)) / rate(() => arrayField(bytes));
    expect(ratio).toBeGreaterThan(0.2);
});
