/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { FilterQuery, convertQueryFilter } from '@deepkit/orm';
import {
    ReflectionClass,
    ReflectionKind,
    Serializer,
    TypeProperty,
    TypePropertySignature,
    resolvePath,
    serializeProperty,
} from '@deepkit/type';

import { SqlError } from './error.js';

export function getSqlFilter<T>(
    classSchema: ReflectionClass<any>,
    filter: FilterQuery<T>,
    parameters: { [name: string]: any } = {},
    serializer: Serializer,
): any {
    return convertQueryFilter(
        classSchema.getClassType(),
        filter || {},
        (convertClass: ReflectionClass<any>, path: string, value: any) => {
            //a filter value is compared against a column, so it must serialize the
            //way that column does. resolvePath returns the property's type without
            //its surroundings, so name the chain it would have inside the entity —
            //otherwise a UUID column stored as binary is compared against a string.
            //resolvePath returns the property member; serialize its type with the
            //member in the chain, so a handler sees the same position it would
            //when the whole entity is serialized
            //null and undefined become IS NULL in SQL; there is nothing to
            //serialize, and an object serializer would dereference them
            if (value === null || value === undefined) return value;

            const resolved = resolvePath(path, classSchema.type);
            const isMember =
                resolved.kind === ReflectionKind.property || resolved.kind === ReflectionKind.propertySignature;
            return serializeProperty(
                value,
                isMember ? (resolved as TypeProperty | TypePropertySignature).type : resolved,
                serializer,
                isMember ? [classSchema.type, resolved] : [],
            );
        },
        {},
        {
            $parameter: (name, value) => {
                if (undefined === parameters[value]) {
                    throw new SqlError(
                        'DK-SQL011',
                        `Parameter ${value} not defined in ${classSchema.getClassName()} query.`,
                    );
                }
                return parameters[value];
            },
        },
    );
}
