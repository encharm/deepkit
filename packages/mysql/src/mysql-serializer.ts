/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { SqlSerializer } from '@deepkit/sql';
import { JsonTypeHandler, binaryTypes, isUUIDType } from '@deepkit/type';

const BASE64_PREFIX = 'base64:type254:';

//for queries with `returning`, MySQL returns binary stuff as base64.
function decodeBase64Binary(value: any): any {
    return typeof value === 'string' && value.startsWith('base64:')
        ? Buffer.from(value.substr(BASE64_PREFIX.length), 'base64')
        : value;
}

const convertBinaryFromBase64: JsonTypeHandler = (type, input, b) => {
    return b.call(decodeBase64Binary, input);
};

class MySQLSerializer extends SqlSerializer {
    name = 'mysql';

    protected registerSerializers() {
        super.registerSerializers();

        for (const binaryType of binaryTypes) {
            this.deserializeRegistry.prependClass(binaryType, convertBinaryFromBase64);
        }

        //a UUID column also arrives base64-encoded from `returning` queries, so
        //decode it before the UUID handler inherited from SqlSerializer reads it
        const uuidHandler = this.deserializeRegistry.getDecorator(isUUIDType);
        this.deserializeRegistry.prependDecorator(isUUIDType, (type, input, b, state) => {
            const decoded = b.call(decodeBase64Binary, input);
            return uuidHandler ? uuidHandler(type, decoded, b, state) : decoded;
        });
    }
}

export const mySqlSerializer = new MySQLSerializer();
