import { expect, test } from '@jest/globals';

import { AutoIncrement, PrimaryKey, deserialize, serialize } from '@deepkit/type';

import { sqlSerializer } from '../src/serializer/sql-serializer.js';

test('array', () => {
    class Address {
        name: string = '';
        street: string = '';
        zip: string = '';
    }

    class Person {
        id: number & PrimaryKey & AutoIncrement = 0;
        tags: string[] = [];
        addresses: Address[] = [];
    }

    const runtime = { id: 1, tags: ['a', 'b'], addresses: [{ name: 'a', street: 'b', zip: 'c' }] };
    const res = serialize<Person>(runtime, undefined, sqlSerializer);
    const record = {
        id: 1,
        tags: JSON.stringify(['a', 'b']),
        addresses: JSON.stringify([{ name: 'a', street: 'b', zip: 'c' }]),
    };
    expect(res).toEqual(record);

    const back = deserialize<Person>(res, undefined, sqlSerializer);
    expect(back).toEqual(runtime);
});

test('object in a union', () => {
    //a union member used to be serialized standalone, away from the property it
    //sits in, so it was never stored as JSON and reached the driver as an object
    class Person {
        id: number & PrimaryKey & AutoIncrement = 0;
        doc: { name: string; tags: string[] } | null = null;
        shape: { a: string } | { b: number } | 54 = 54;
    }

    const runtime = { id: 1, doc: { name: 'peter', tags: ['a'] }, shape: { b: 2 } };
    const res = serialize<Person>(runtime, undefined, sqlSerializer);
    //the nested array is part of the JSON document, not encoded a second time
    expect(res).toEqual({ id: 1, doc: JSON.stringify({ name: 'peter', tags: ['a'] }), shape: JSON.stringify({ b: 2 }) });
    expect(deserialize<Person>(res, undefined, sqlSerializer)).toEqual(runtime);

    const unset = { id: 2, doc: null, shape: 54 };
    expect(serialize<Person>(unset, undefined, sqlSerializer)).toEqual(unset);
    expect(deserialize<Person>(unset, undefined, sqlSerializer)).toEqual(unset);
});
