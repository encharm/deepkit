/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { ClassType } from '@deepkit/core';
import { QueryCustomFields, QueryFieldNames, convertQueryFilter } from '@deepkit/orm';
import {
    ReflectionClass,
    ReflectionKind,
    Serializer,
    Type,
    TypeProperty,
    TypePropertySignature,
    deserialize,
    resolvePath,
    serializeProperty,
    serializer,
} from '@deepkit/type';

import './mongo-serializer';
import { mongoSerializer } from './mongo-serializer.js';
import { FilterQuery } from './query.model.js';

/**
 * resolvePath returns the property member; a value is serialized as the type it
 * carries, with the member named as its position, so handlers that depend on
 * where a value sits behave as they do for the whole document.
 */
function memberAndType(schema: ReflectionClass<any>, path: string): { type: Type; parentTypes: Type[] } {
    const resolved = resolvePath(path, schema.type);
    const isMember = resolved.kind === ReflectionKind.property || resolved.kind === ReflectionKind.propertySignature;
    return isMember
        ? { type: (resolved as TypeProperty | TypePropertySignature).type, parentTypes: [schema.type, resolved] }
        : { type: resolved, parentTypes: [] };
}

function serializeFilterValue(schema: ReflectionClass<any>, path: string, value: any, use: Serializer): any {
    const { type, parentTypes } = memberAndType(schema, path);
    return serializeProperty(value, type, use, parentTypes);
}

function deserializeFilterValue(schema: ReflectionClass<any>, path: string, value: any): any {
    const { type } = memberAndType(schema, path);
    return deserialize(value, undefined, serializer, undefined, type);
}

export function convertClassQueryToMongo<T, K extends keyof T, Q extends FilterQuery<T>>(
    classType: ReflectionClass<T> | ClassType,
    query: Q,
    fieldNamesMap: QueryFieldNames = {},
    customMapping: {
        [name: string]: (name: string, value: any, fieldNamesMap: { [name: string]: boolean }) => any;
    } = {},
): Q {
    const schema = ReflectionClass.from(classType);
    return convertQueryFilter(
        schema,
        query,
        (convertClassType: ReflectionClass<any>, path: string, value: any) => {
            return serializeFilterValue(schema, path, value, mongoSerializer);
        },
        fieldNamesMap,
        customMapping,
    );
}

export function convertPlainQueryToMongo<T, K extends keyof T>(
    classType: ClassType<T>,
    target: FilterQuery<T>,
    fieldNamesMap: QueryFieldNames = {},
    customMapping: QueryCustomFields = {},
): { [path: string]: any } {
    return convertQueryFilter(
        classType,
        target,
        (convertClassType: ReflectionClass<any>, path: string, value: any) => {
            const classValue = deserializeFilterValue(convertClassType, path, value);
            return serializeFilterValue(convertClassType, path, classValue, mongoSerializer);
        },
        fieldNamesMap,
        customMapping,
    );
}
