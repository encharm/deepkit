/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { ValueWithBSONSerializer } from '@deepkit/bson';
import {
    JsonTypeHandler,
    ReflectionClass,
    ReflectionKind,
    Serializer,
    Type,
    isBinaryBigIntType,
    isMongoIdType,
    isReferenceType,
    isUUIDType,
} from '@deepkit/type';

/**
 * Wraps a value with the type BSON should encode it as.
 *
 * Filters and patches are typed `any` (spelling out the real type would be
 * impractical), so the BSON serializer would otherwise see a plain string and
 * lose the fact that it is a MongoId, UUID or binary bigint.
 */
function wrapValue(value: any, type: Type): ValueWithBSONSerializer {
    return new ValueWithBSONSerializer(value, type);
}

/**
 * A serializer that converts values to a wrapped value so that the BSON
 * serializer knows how to encode them where the document declares `any`.
 */
class MongoAnySerializer extends Serializer {
    name = 'mongo';

    protected registerSerializers() {
        super.registerSerializers();

        this.serializeRegistry.register(ReflectionKind.string, (type, input, b) => {
            if (!isUUIDType(type) && !isMongoIdType(type)) return input;
            return b.call(wrapValue, input, b.lit(type));
        });

        this.serializeRegistry.register(ReflectionKind.bigint, (type, input, b) => {
            if (!isBinaryBigIntType(type)) return input;
            return b.call(wrapValue, input, b.lit(type));
        });

        this.serializeRegistry.append(ReflectionKind.class, (type, input, b, state) => {
            if (!isReferenceType(type)) return input;
            if (type.kind !== ReflectionKind.class && type.kind !== ReflectionKind.objectLiteral) return input;

            const primary = ReflectionClass.from(type).getPrimary();
            //an unhydrated reference is stored as its primary key, but a value
            //that is already wrapped has been converted and is passed through
            return b.ternary(
                b.call(
                    (v: any) => v !== null && typeof v === 'object' && !(v instanceof ValueWithBSONSerializer),
                    input,
                ),
                state.build(primary.getType(), input.get(primary.getName())),
                input,
            );
        });

        this.serializeRegistry.register(ReflectionKind.undefined, (type, input, b) => b.lit(null));
        this.deserializeRegistry.register(ReflectionKind.undefined, (type, input, b) => b.lit(undefined));
    }
}

export const mongoSerializer = new MongoAnySerializer();
