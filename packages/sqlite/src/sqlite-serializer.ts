/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { SqlSerializer, isDirectPropertyOfEntity } from '@deepkit/sql';
import { ReflectionKind } from '@deepkit/type';

class SQLiteSerializer extends SqlSerializer {
    name = 'sqlite';
    protected registerSerializers() {
        super.registerSerializers();

        this.serializeRegistry.registerClass(Date, (type, input, b) => {
            return b.call((d: Date) => d.toJSON(), input);
        });

        this.serializeRegistry.append(ReflectionKind.boolean, (type, input, b, state) => {
            //sqlite has no boolean column type, so a direct column is stored as 0/1
            if (!isDirectPropertyOfEntity(state)) return input;
            return b.ternary(input, b.lit(1), b.lit(0));
        });
    }
}

export const sqliteSerializer = new SQLiteSerializer();
