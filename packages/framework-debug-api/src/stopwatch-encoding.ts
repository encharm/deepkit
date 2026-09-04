import { deserializeBSONWithoutOptimiser, getBSONDeserializer, getBSONSerializer } from '@deepkit/bson';
import { createBuffer } from '@deepkit/core';
import { AnalyticData, FrameData, FrameEnd, FrameStart, FrameType, getTypeOfCategory } from '@deepkit/stopwatch';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

/**
 * Byte length of `str` when encoded as UTF-8.
 *
 * Replaces the helper `@deepkit/bson` exported before its rewrite. This module
 * frames a bespoke binary layout rather than BSON documents, so it carries its
 * own reader/writer instead of widening the BSON public API.
 */
function stringByteLength(str: string): number {
    let size = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code < 0x80) size += 1;
        else if (code < 0x800) size += 2;
        else if (code >= 0xd800 && code < 0xdc00) {
            //surrogate pair encodes to 4 bytes and consumes both code units
            size += 4;
            i++;
        } else size += 3;
    }
    return size;
}

/** Little-endian writer for the frame/analytic binary layouts. */
class Writer {
    offset = 0;
    private view: DataView;

    constructor(public buffer: Uint8Array) {
        this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    writeByte(v: number) {
        this.buffer[this.offset++] = v;
    }

    writeUint32(v: number) {
        this.view.setUint32(this.offset, v, true);
        this.offset += 4;
    }

    writeDouble(v: number) {
        this.view.setFloat64(this.offset, v, true);
        this.offset += 8;
    }

    writeBuffer(buffer: Uint8Array) {
        this.buffer.set(buffer, this.offset);
        this.offset += buffer.byteLength;
    }

    /** Writes the raw UTF-8 bytes of `str`, with no terminator. */
    writeString(str: string) {
        if (!str) return;
        this.offset += textEncoder.encodeInto(str, this.buffer.subarray(this.offset)).written;
    }
}

/** Little-endian reader matching {@link Writer}. */
class Parser {
    constructor(
        public buffer: Uint8Array,
        public offset: number = 0,
        private view: DataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    ) {}

    eatByte(): number {
        return this.buffer[this.offset++];
    }

    eatUInt32(): number {
        const v = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return v;
    }

    peekUInt32(): number {
        return this.view.getUint32(this.offset, true);
    }

    eatDouble(): number {
        const v = this.view.getFloat64(this.offset, true);
        this.offset += 8;
        return isNaN(v) ? 0 : v;
    }

    /** Reads exactly `size` raw UTF-8 bytes (no terminator). */
    eatString(size: number): string {
        const v = textDecoder.decode(this.buffer.subarray(this.offset, this.offset + size));
        this.offset += size;
        return v;
    }
}

export function encodeFrames(frames: (FrameStart | FrameEnd)[]): Uint8Array {
    //cid = id and worker, as compound key
    //<cid uint32><type uint8><timestamp uint64><context uint32><category uint8><labelSize uint8><label utf8string>.
    let size = 0;
    for (const frame of frames) {
        size +=
            frame.type === FrameType.end
                ? (32 + 8 + 64) / 8
                : (32 + 8 + 64 + 32 + 8 + 8) / 8 + Math.min(255, stringByteLength(frame.label));
    }

    const buffer = createBuffer(size);
    const writer = new Writer(buffer);

    for (const frame of frames) {
        writer.writeUint32(frame.cid);
        writer.writeByte(frame.type);

        //up to 2⁵³=9,007,199,254,740,992 the representable numbers are exactly the integers
        //so we have no precision loss when using timestamp=Math.floor(performance.timeOrigin * 1_000 + performance.now() * 1_000)
        //timestamp current output vs max precise integers:
        //1613654358960142
        //9007199254740992
        writer.writeDouble(frame.timestamp);

        if (frame.type === FrameType.start) {
            writer.writeUint32(frame.context);
            writer.writeByte(frame.category);
            let size = stringByteLength(frame.label);
            for (let i = 0; size > 255; i++) {
                frame.label = frame.label.substr(0, 255 - i);
                size = stringByteLength(frame.label);
            }
            writer.writeByte(size);
            writer.writeString(frame.label);
        }
    }

    return buffer;
}

export function encodeFrameData(dataItems: FrameData[]): Uint8Array {
    //<cid uint32><bson document>
    //the BSON serializer returns [sharedBuffer, size] and reuses that buffer
    //across calls, so every document is copied out before the next serialize
    let size = 0;
    const documents: (Uint8Array | undefined)[] = [];
    for (const data of dataItems) {
        const type = getTypeOfCategory(data.category);
        let document: Uint8Array | undefined;
        if (type) {
            const [buffer, documentSize] = getBSONSerializer(type)(data.data);
            document = buffer.slice(0, documentSize);
        }
        documents.push(document);
        size += (32 + 8) / 8 + (document ? document.byteLength : 4); //4 = the uint32 written when untyped
    }

    const buffer = createBuffer(size);
    const writer = new Writer(buffer);

    for (let i = 0; i < dataItems.length; i++) {
        writer.writeUint32(dataItems[i].cid);
        writer.writeByte(dataItems[i].category);
        const document = documents[i];
        if (document) {
            writer.writeBuffer(document);
        } else {
            writer.writeUint32(0);
        }
    }

    return buffer;
}

export function encodeAnalytic(data: AnalyticData[]): Uint8Array {
    //<timestamp uint64><cpu uint8><memory uint8><loopBlocked uint8>
    const buffer = createBuffer(data.length * (4 + 1 + 1 + 4));
    const writer = new Writer(buffer);

    for (const item of data) {
        writer.writeUint32(item.timestamp);
        writer.writeByte(item.cpu);
        writer.writeByte(item.memory);
        writer.writeUint32(item.loopBlocked);
    }

    return buffer;
}

export function decodeAnalytic(buffer: Uint8Array, callback: (data: AnalyticData) => void) {
    const parser = new Parser(buffer);

    while (parser.offset < buffer.byteLength) {
        const timestamp = parser.eatUInt32();
        const cpu = parser.eatByte();
        const memory = parser.eatByte();
        const loopBlocked = parser.eatUInt32();
        callback({ timestamp, cpu, memory, loopBlocked });
    }
}

export function decodeFrameData(
    buffer: Uint8Array,
    callback: (data: { cid: number; category: number; data: Uint8Array }) => void,
) {
    const parser = new Parser(buffer);

    while (parser.offset < buffer.byteLength) {
        const cid = parser.eatUInt32();
        const category = parser.eatByte();
        const end = parser.peekUInt32() + parser.offset;
        callback({ cid, category, data: parser.buffer.slice(parser.offset, end) });
        parser.offset = end;
    }
}

export function deserializeFrameData(data: { cid: number; category: number; data: Uint8Array }): any {
    const classType = getTypeOfCategory(data.category);
    const deserializer = classType ? getBSONDeserializer(classType) : deserializeBSONWithoutOptimiser;
    return deserializer(data.data);
}

export function decodeFrames(buffer: Uint8Array, callback: (frame: FrameStart | FrameEnd) => void): void {
    const parser = new Parser(buffer);

    while (parser.offset < buffer.byteLength) {
        const cid = parser.eatUInt32();
        const type = parser.eatByte();
        const timestamp = parser.eatDouble();

        if (type === FrameType.start) {
            const context = parser.eatUInt32();
            const category = parser.eatByte();
            const stringSize = parser.eatByte();
            const label = parser.eatString(stringSize);
            callback({ cid, type: FrameType.start, timestamp, context, category, label });
        } else {
            callback({ cid, type: FrameType.end, timestamp });
        }
    }
}
