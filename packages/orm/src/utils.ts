/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import sift from 'sift';

import { isObject } from '@deepkit/core';
import {
    Changes,
    HandlerRegistry,
    JsonBuildContext,
    PrimaryKeyFields,
    ReflectionClass,
    createReference,
    getSerializeFunction,
} from '@deepkit/type';

import { getInstanceStateFromItem } from './identity-map.js';
import { FilterQuery } from './query.js';
import { OrmEntity } from './type.js';

export type FlattenIfArray<T> = T extends Array<any> ? T[0] : T;
export type FieldName<T> = keyof T & string;

export function getClassSchemaInstancePairs<T extends OrmEntity>(
    items: Iterable<[ReflectionClass<any>, T]>,
): Map<ReflectionClass<any>, T[]> {
    const map = new Map<ReflectionClass<any>, T[]>();

    for (const [classSchema, item] of items) {
        let items = map.get(classSchema);
        if (!items) {
            items = [];
            map.set(classSchema, items);
        }
        items.push(item);
    }

    return map;
}

export function findQuerySatisfied<T extends { [index: string]: any }>(target: T, query: FilterQuery<T>): boolean {
    //get rid of "Excessive stack depth comparing types 'any' and 'SiftQuery<T[]>'."
    return (sift as any)(query as any, [target] as any[]).length > 0;
}

export function findQueryList<T extends { [index: string]: any }>(items: T[], query: FilterQuery<T>): T[] {
    //get rid of "Excessive stack depth comparing types 'any' and 'SiftQuery<T[]>'."
    return (sift as any)(query as any, items as any[]);
}

export type Placeholder<T> = () => T;
export type Resolve<T extends { _: Placeholder<any> }> = ReturnType<T['_']>;
export type Replace<T, R> = T & { _: Placeholder<R> };

export function buildChangesFromInstance<T extends object>(item: T): Changes<T> {
    const state = getInstanceStateFromItem(item);
    const lastSnapshot = state.getSnapshot();
    const currentSnapshot = state.classState.snapshot(item);
    return state.classState.changeDetector(lastSnapshot, currentSnapshot, item) || new Changes();
}

/**
 * Converts a scala value to a primary key fields object.
 */
export function primaryKeyObjectConverter(
    classSchema: ReflectionClass<any>,
    templateRegistry: HandlerRegistry<JsonBuildContext>,
): (data: any) => PrimaryKeyFields<any> {
    const primary = classSchema.getPrimary();
    const primaryKeyConverted = getSerializeFunction(primary.property, templateRegistry);

    //a primary key can itself be a reference, in which case the database hands
    //back the foreign key and the caller expects the reference object
    if (primary.isReference()) {
        const foreign = primary.getResolvedReflectionClass();
        const foreignPk = foreign.getPrimary();
        return data => {
            if (data === null || data === undefined) return { [primary.name]: data } as any;
            const value = isObject(data) ? (data as any)[foreignPk.name] : data;
            return { [primary.name]: createReference(foreign.getClassType(), { [foreignPk.name]: value }) } as any;
        };
    }

    return data => {
        return { [primary.name]: primaryKeyConverted(data) };
    };
}
