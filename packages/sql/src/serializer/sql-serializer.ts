/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { Builder, Ref } from '@deepkit/core';
import {
    JsonBuildContext,
    JsonTypeHandler,
    ReflectionClass,
    ReflectionKind,
    Serializer,
    Type,
    TypeArray,
    TypeClass,
    TypeObjectLiteral,
    TypeUnion,
    deserializeClass,
    handleObjectLiteral,
    handleUnion,
    isBackReferenceType,
    isPropertyMemberType,
    isReferenceType,
    isUUIDType,
    nodeBufferToArrayBuffer,
    nodeBufferToTypedArray,
    referenceAnnotation,
    typedArrayToBuffer,
    uuidAnnotation,
} from '@deepkit/type';

import { typeRequiresJSONCast } from '../platform/default-platform.js';

export const hexTable: string[] = [];
for (let i = 0; i < 256; i++) {
    hexTable[i] = (i <= 15 ? '0' : '') + i.toString(16);
}

/**
 * Only direct properties of an entity will be serialized in some special way.
 * Deeper types get the normal JSON serialization.
 */
export function isDirectPropertyOfEntity(state: JsonBuildContext): boolean {
    // Entities can be child of another entity without Reference,
    // so in order to detect a type being in direct property of an entity,
    // we look at state.parentTypes, which can only be
    //  - [class|objectLiteral, property|indexSignature, this];
    //  - [class|objectLiteral, property|indexSignature, union, this];
    //  - [property|indexSignature, this];
    //  - [property|indexSignature, union, this];
    //  - [class|objectLiteral, property|indexSignature, Class|objectLiteral & Reference, this];
    //  - [property|indexSignature, Class|objectLiteral & Reference, this];

    const parentTypes = state.parentTypes;
    if (parentTypes.length < 2) return false;

    if (isPropertyMemberType(parentTypes[0]) || parentTypes[0].kind === ReflectionKind.indexSignature) {
        if (parentTypes[1].kind === ReflectionKind.union) {
            return parentTypes.length === 3;
        }

        if (parentTypes.length === 3 && isReferenceType(parentTypes[1])) {
            return true;
        }

        return parentTypes.length === 2;
    }

    if (parentTypes.length < 3) return false;

    if (parentTypes[0].kind !== ReflectionKind.class && parentTypes[0].kind !== ReflectionKind.objectLiteral) {
        return false;
    }

    if (
        parentTypes[1].kind !== ReflectionKind.property &&
        parentTypes[1].kind !== ReflectionKind.propertySignature &&
        parentTypes[1].kind !== ReflectionKind.indexSignature
    ) {
        return false;
    }

    if (parentTypes[2].kind === ReflectionKind.union) {
        return parentTypes.length === 3 || parentTypes.length === 4;
    }

    if (parentTypes.length === 4 && isReferenceType(parentTypes[2])) {
        return true;
    }

    return parentTypes.length === 3;
}

/** Parses a column that the database returns as a JSON string. */
function parseJsonColumn(value: any): any {
    return 'string' === typeof value ? JSON.parse(value) : value;
}

const serializeSqlAny: JsonTypeHandler = (type, input, b, state) => {
    if (!isDirectPropertyOfEntity(state)) return input;
    return b.call(JSON.stringify, input);
};

const deserializeSqlAny: JsonTypeHandler = (type, input, b, state) => {
    if (!isDirectPropertyOfEntity(state)) return input;
    return b.call(parseJsonColumn, input);
};

/**
 * For sql databases, arrays are stored as a JSON string.
 */
const serializeSqlArray: JsonTypeHandler = (type, input, b, state) => {
    if (undefined !== referenceAnnotation.getFirst(type as TypeArray)) return input;
    if (!isDirectPropertyOfEntity(state)) return input;
    return b.call(JSON.stringify, input);
};

const deserializeSqlArray: JsonTypeHandler = (type, input, b, state) => {
    if (undefined !== referenceAnnotation.getFirst(type as TypeArray)) return input;
    if (!isDirectPropertyOfEntity(state)) return input;
    return b.call(parseJsonColumn, input);
};

/**
 * A reference is stored as its primary key only, so serialize just that.
 */
const serializeReferencedType: JsonTypeHandler = (type, input, b, state) => {
    if (type.kind !== ReflectionKind.class && type.kind !== ReflectionKind.objectLiteral) return input;
    const primary = ReflectionClass.from(type).getPrimary();
    //an unhydrated reference carries only the primary key
    return state.build(primary.getType(), input.get(primary.getName()));
};

const deserializeReferencedType: JsonTypeHandler = (type, input, b, state) => {
    if (type.kind !== ReflectionKind.class && type.kind !== ReflectionKind.objectLiteral) return input;
    const primary = ReflectionClass.from(type).getPrimary();
    return state.build(primary.getType(), input);
};

/**
 * Handlers registered for a class (Date, Set, Map, binary types) take
 * precedence: a registered kind handler for `class` would otherwise shadow
 * them, and a Date column would be treated as a JSON object.
 */
function classHandlersFor(type: Type, state: JsonBuildContext) {
    if (type.kind !== ReflectionKind.class) return undefined;
    const handlers = state.registry.getClassHandlers((type as TypeClass).classType);
    return handlers.length > 0 ? handlers : undefined;
}

function runHandlers(handlers: JsonTypeHandler[], type: Type, input: Ref, b: Builder, state: JsonBuildContext): Ref {
    let result = input;
    for (const handler of handlers) result = handler(type, result, b, state);
    return result;
}

/**
 * For sql databases, objects will be serialised as JSON string.
 */
const serializeSqlObjectLiteral: JsonTypeHandler = (type, input, b, state) => {
    //a database column always stores the foreign key, `& Inline` or not — it
    //only changes how a reference is serialized for transport
    if (isReferenceType(type) || isBackReferenceType(type)) {
        return serializeReferencedType(type, input, b, state);
    }

    const classHandlers = classHandlersFor(type, state);
    if (classHandlers) return runHandlers(classHandlers, type, input, b, state);

    const serialized = handleObjectLiteral(type as TypeClass | TypeObjectLiteral, input, b, state);
    //TypeClass|TypeObjectLiteral properties are serialized as JSON
    if (!isDirectPropertyOfEntity(state)) return serialized;
    return b.call(JSON.stringify, serialized);
};

/**
 * For sql databases, objects will be serialised as JSON string. So deserialize it correctly.
 */
const deserializeSqlObjectLiteral: JsonTypeHandler = (type, input, b, state) => {
    if (isReferenceType(type) || isBackReferenceType(type)) {
        return deserializeReferencedType(type, input, b, state);
    }

    const classHandlers = classHandlersFor(type, state);
    if (classHandlers) return runHandlers(classHandlers, type, input, b, state);

    //the column arrives as a JSON string, so parse it before reading members
    const value = isDirectPropertyOfEntity(state) ? b.call(parseJsonColumn, input) : input;
    //a class must come back as an instance of itself, which only deserializeClass
    //does — handleObjectLiteral would produce a plain object
    if (type.kind === ReflectionKind.class) {
        return deserializeClass(type, value, b, state);
    }
    return handleObjectLiteral(type as TypeObjectLiteral, value, b, state);
};

const serializeSqlUnion: JsonTypeHandler = (type, input, b, state) => {
    return handleUnion(type as TypeUnion, input, b, state);
};

const deserializeSqlUnion: JsonTypeHandler = (type, input, b, state) => {
    // usually DB return JSON string, which we need to convert to objects first so the default union handler can work.
    // This must currently be in line with Platform's type detection (this.addType()),
    // so this code expects that typeRequiresJSONCast knows when all platforms store JSON in the database,
    // which may change in the future. Then we need to have information from the platform in this template function here.
    const value =
        isDirectPropertyOfEntity(state) && typeRequiresJSONCast(type) ? b.call(parseJsonColumn, input) : input;
    return handleUnion(type as TypeUnion, value, b, state);
};

export class SqlSerializer extends Serializer {
    name = 'sql';

    override setExplicitUndefined(type: Type, state: JsonBuildContext): boolean {
        //make sure that `foo?: string` is not explicitly set to undefined when database returns `null`.
        if (state.direction === 'deserialize') return false;
        return true;
    }

    protected registerSerializers() {
        super.registerSerializers();

        //SQL escape does the job, so pass the Date through untouched.
        this.serializeRegistry.registerClass(Date, (type, input) => input);

        this.serializeRegistry.register(ReflectionKind.any, serializeSqlAny);
        this.deserializeRegistry.register(ReflectionKind.any, deserializeSqlAny);

        //remove string enforcement, since UUID/MongoId are string but received as binary
        this.deserializeRegistry.register(ReflectionKind.string, (type, input) => input);

        //these take precedence over the string handling inherited from the base serializer
        this.deserializeRegistry.prependDecorator(isUUIDType, (type, input, b) => {
            return b.call(uuid4StringifyLenient, input);
        });

        this.serializeRegistry.prependDecorator(isUUIDType, (type, input, b, state) => {
            if (!isDirectPropertyOfEntity(state)) return input;
            return b.call(uuid4BinaryStrict, input);
        });

        //annotation handlers run before kind handlers, so the reference decorator
        //inherited from the base serializer would inline a `& Inline` reference.
        //A database column always stores the foreign key.
        this.serializeRegistry.prependDecorator(isReferenceType, serializeReferencedType);
        this.deserializeRegistry.prependDecorator(isReferenceType, deserializeReferencedType);

        this.serializeRegistry.register(ReflectionKind.class, serializeSqlObjectLiteral);
        this.serializeRegistry.register(ReflectionKind.objectLiteral, serializeSqlObjectLiteral);

        this.deserializeRegistry.register(ReflectionKind.class, deserializeSqlObjectLiteral);
        this.deserializeRegistry.register(ReflectionKind.objectLiteral, deserializeSqlObjectLiteral);

        this.serializeRegistry.append(ReflectionKind.array, serializeSqlArray);
        this.deserializeRegistry.prepend(ReflectionKind.array, deserializeSqlArray);

        this.serializeRegistry.register(ReflectionKind.union, serializeSqlUnion);
        this.deserializeRegistry.register(ReflectionKind.union, deserializeSqlUnion);

        this.serializeRegistry.registerBinary((type, input, b) => {
            if ((type as TypeClass).classType === ArrayBuffer) {
                return b.call((v: ArrayBuffer) => Buffer.from(v), input);
            }
            return b.call(typedArrayToBuffer, input);
        });

        this.deserializeRegistry.registerBinary((type, input, b) => {
            if ((type as TypeClass).classType === ArrayBuffer) {
                return b.call(nodeBufferToArrayBuffer, input);
            }
            return b.call(nodeBufferToTypedArray, input, b.lit((type as TypeClass).classType));
        });
    }
}

export const sqlSerializer: Serializer = new SqlSerializer();

/** Serializes a UUID column, rejecting values that are not valid UUID v4. */
function uuid4BinaryStrict(v: any): Buffer {
    try {
        return uuid4Binary(v);
    } catch (error) {
        throw new TypeError('Invalid UUID v4: ' + error);
    }
}

/** Reads a UUID column, which the driver may hand back as string or binary. */
function uuid4StringifyLenient(v: any): string {
    if ('string' === typeof v) return v;
    try {
        return uuid4Stringify(v);
    } catch (error) {
        throw new TypeError('Invalid UUID v4: ' + error);
    }
}

export function uuid4Binary(u: any): Buffer {
    return 'string' === typeof u ? Buffer.from(u.replace(/-/g, ''), 'hex') : Buffer.alloc(0);
}

export function uuid4Stringify(buffer: Buffer): string {
    return (
        hexTable[buffer[0]] +
        hexTable[buffer[1]] +
        hexTable[buffer[2]] +
        hexTable[buffer[3]] +
        '-' +
        hexTable[buffer[4]] +
        hexTable[buffer[5]] +
        '-' +
        hexTable[buffer[6]] +
        hexTable[buffer[7]] +
        '-' +
        hexTable[buffer[8]] +
        hexTable[buffer[9]] +
        '-' +
        hexTable[buffer[10]] +
        hexTable[buffer[11]] +
        hexTable[buffer[12]] +
        hexTable[buffer[13]] +
        hexTable[buffer[14]] +
        hexTable[buffer[15]]
    );
}
