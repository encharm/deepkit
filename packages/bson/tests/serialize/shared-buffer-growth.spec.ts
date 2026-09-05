/**
 * The serializers write into one shared scratch buffer. A document larger than
 * it must still serialize intact: a Uint8Array write past the end is dropped
 * silently while the offset keeps advancing, so without a growth path the
 * result was a size beyond capacity and a silently truncated copy.
 *
 * Run standalone: node --import @deepkit/run --test tests/serialize/shared-buffer-growth.spec.ts
 */
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { deserializeBSON, deserializeBSONWithoutOptimiser, getBSONSerializer, serializeBSON, serializeBSONWithoutOptimiser } from '../../index.js';

interface Big {
    id: number;
    blob: string;
}

const initialCapacity = 1024 * 1024;

test('a document larger than the shared buffer serializes intact (JIT)', () => {
    for (const kb of [1024, 2048, 4096]) {
        const blob = 'x'.repeat(kb * 1024);
        const [buffer, size] = getBSONSerializer<Big>()({ id: 1, blob });
        expect(size).toBeGreaterThan(initialCapacity);
        expect(size).toBeLessThanOrEqual(buffer.length);

        const back = deserializeBSON<Big>(serializeBSON<Big>({ id: 1, blob }));
        expect(back.blob.length).toBe(blob.length);
        expect(back.blob).toBe(blob);
    }
});

test('a document larger than the shared buffer serializes intact (union member)', () => {
    type Either = { kind: 'a'; blob: string } | { kind: 'b'; n: number };
    const blob = 'y'.repeat(2 * 1024 * 1024);
    const back = deserializeBSON<Either>(serializeBSON<Either>({ kind: 'a', blob }));
    expect(back).toEqual({ kind: 'a', blob });
});

test('a document larger than the shared buffer serializes intact (untyped)', () => {
    for (const kb of [1024, 2048]) {
        const blob = 'z'.repeat(kb * 1024);
        const bytes = serializeBSONWithoutOptimiser({ id: 1, blob });
        expect(bytes.length).toBeGreaterThan(initialCapacity);
        expect(deserializeBSONWithoutOptimiser(bytes).blob).toBe(blob);
    }
});

test('a small document still serializes after the buffer has grown', () => {
    serializeBSON<Big>({ id: 1, blob: 'g'.repeat(3 * 1024 * 1024) });
    const back = deserializeBSON<Big>(serializeBSON<Big>({ id: 2, blob: 'small' }));
    expect(back).toEqual({ id: 2, blob: 'small' });
});

test('untyped string values are encoded as UTF-8 byte for byte', () => {
    //the untyped path writes string values straight into the buffer instead
    //of encoding into a fresh array first, so pin every width and surrogates
    const cases = ['', 'hello', 'café Zürich', 'Привет', '日本語', '🎉🚀', '👨‍👩‍👧‍👦', 'a¢€𐍈z', 'tab\tnl\n'];
    for (const v of cases) {
        const bytes = serializeBSONWithoutOptimiser({ v });
        //int32 size + type byte + "v\0" + int32 length + bytes + \0 + doc terminator
        expect(bytes.length).toBe(4 + 1 + 2 + 4 + Buffer.byteLength(v, 'utf8') + 1 + 1);
        expect(deserializeBSONWithoutOptimiser(bytes).v).toBe(v);
    }
});
