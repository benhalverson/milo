import Platform from '../../#{target}/Platform';
import DataBuffer from '../../#{target}/DataBuffer'

import {
    FramerState,
    WSState,
    WSCallback,
} from './types';

import {
    BufferPool,
    parse64BigInt,
} from '../buffer';

import {
    NetworkPipe,
    IDataBuffer,
} from '../../types';

import {
    assert
} from '../../utils';

import maskFn from '../mask';

import {
    Opcodes
} from '../types';

export default class WSFramer {
    private callbacks: WSCallback[];
    private maxFrameSize: number;
    private maxPacketSize: number;
    private msgState: WSState;
    private controlState: WSState;
    private closed: boolean;
    private pipe: NetworkPipe;

    constructor(pipe: NetworkPipe, maxFrameSize = 8096, maxPacketSize = 1024 * 1024 * 4) {
        this.callbacks = [];
        this.pipe = pipe;
        this.maxFrameSize = maxFrameSize;
        this.maxPacketSize = maxPacketSize;
        this.msgState = createDefaultState();
        this.controlState = createDefaultState(true);
        this.closed = false;
    }

    getActiveState() {
        return this.controlState.state > this.msgState.state ?
            this.controlState : this.msgState;
    }

    onFrame(cb: WSCallback) {
        this.callbacks.push(cb);
    }

    // TODO: Contiuation frames, spelt wrong
    send(buf: IDataBuffer, offset: number,
        length: number, frameType: Opcodes = Opcodes.BinaryFrame) {

        if (length > 2 ** 32) {
            throw new Error("You are dumb");
        }

        const endIdx = offset + length;
        let ptr = offset;
        let ptrLength = 0;
        let ft = frameType;
        let count = 0;

        const header = headerPool.malloc();
        assert(header, "Gotta have header");

        header.setUInt8(0, 0);

        do {
            const ptrStart = ptr;

            if (ptr > offset) {
                ft = Opcodes.ContinuationFrame;
            }

            const frameSize = Math.min(endIdx - ptr, this.maxFrameSize);
            const mask = generateMask();
            const headerEnd = constructFrameHeader(
                header, true, ft, frameSize, mask);

            const fullBuf = new DataBuffer(headerEnd + frameSize);

            fullBuf.set(0, header);

            fullBuf.set(headerEnd, buf, ptr, frameSize);
            ptr += frameSize;

            maskFn(fullBuf, headerEnd, frameSize, mask);

            // TODO if fullBuf is just to slow to send upgrade the socket
            // library to handle the same reference to the buf with different
            // offsets.
            this.pipe.write(fullBuf, 0, fullBuf.byteLength);

            ptrLength += ptr - ptrStart;

        } while (ptrLength < length);

        headerPool.free(header);
    }

    /**
     * Does some basic logic to check if the header is completed.
     */
    isHeaderComplete(packet: IDataBuffer, offset: number, length: number): boolean {
        let ptr = offset;
        throw new Error("Not Implemented");
    }

    isControlFrame(packet: IDataBuffer, offset: number): boolean {
        const opCode = (packet.getUInt8(offset) & 0x0F);

        return opCode === Opcodes.Ping ||
            opCode === Opcodes.Pong ||
            opCode === Opcodes.CloseConnection;
    }

    // TODO: Handle Continuation.
    processStreamData(packet: IDataBuffer, offset: number, endIdx: number) {

        if (this.closed) {
            throw new Error("Hey, closed for business bud.");
        }

        let ptr = offset;
        let state = this.getActiveState();

        do {
            if (state.state === State.Waiting ||
                state.state === State.WaitingForCompleteHeader) {

                // First check to see if there is enough to parse
                if (!this.isHeaderParsable(state, packet, offset, endIdx)) {
                    return false;
                }


                // ITS GONNA DO IT.
                if (state.state === State.Waiting &&
                    this.isControlFrame(packet, ptr)) {
                    state = this.controlState;
                }

                let nextPtrOffset: number | boolean = 0;
                if (state.state === State.Waiting) {
                    nextPtrOffset = this.parseHeader(state, packet, ptr, endIdx);
                }

                else {
                    // TODO: Stitching control frames???
                    // CONFUSING, stitch the two headers together, and call it
                    // a day.
                    const headerBuf = headerPool.malloc();
                    const payloadByteLength = state.payload.byteLength;

                    assert(headerBuf, "Gotta have headerBuf");

                    headerBuf.set(0, state.payload, 0, payloadByteLength);
                        packet.subarray(ptr, headerBuf.byteLength - payloadByteLength),
                        headerBuf.set(payloadByteLength, packet, ptr,
                            headerBuf.byteLength - payloadByteLength);

                    nextPtrOffset =
                        this.parseHeader(state, headerBuf, 0, MAX_HEADER_SIZE);

                    if (typeof nextPtrOffset === 'boolean') {
                        throw new Error("WHAT JUST HAPPENED HERE, DEBUG ME PLEASE");
                    }

                    nextPtrOffset -= payloadByteLength;
                    headerPool.free(headerBuf);
                }

                if (nextPtrOffset === false) {

                    state.state = State.WaitingForCompleteHeader;
                    state.payload = packet.slice(ptr, endIdx - ptr);

                    break;
                }

                else {
                    // @ts-ignore
                    ptr = offset + nextPtrOffset;
                }
            }

            state.state = State.ParsingBody;
            const remainingPacket = state.payloadLength - state.payloadPtr;
            const subEndIdx = Math.min(ptr + remainingPacket, endIdx);

            ptr += this.parseBody(state, packet, ptr, subEndIdx);

            const endOfPayload = state.payloadLength === state.payloadPtr;
            if (state.isFinished && endOfPayload) {
                state.isFinished = false;
                state.state = State.Waiting;
                this.pushFrame(state);

                if (state.opcode === Opcodes.CloseConnection) {
                    this.closed = true;
                }
            }

            // TODO: we about to go into contiuation mode, so get it baby!
            else if (!state.isFinished && endOfPayload) {
                if (!state.payloads)
                    state.payloads = [];
                state.payloads.push(state.payload);
                state.state = State.Waiting;
            }

        } while (ptr < endIdx);
    }

    private getByteBetween(state: WSState, packet: IDataBuffer, offset: number, endIdx: number): number {

        return 0;
    }

    private parseBody(
        state: WSState, packet: IDataBuffer,
        offset: number, endIdx: number): number {

        // TODO: When the packet has multiple frames in it, i need to be able
        // to read what I need to read, not the whole thing, segfault incoming

        // TODO: is this ever needed?
        const remaining = state.payloadLength - state.payloadPtr;
        const sub = packet.subarray(offset, endIdx - offset);

        state.payload.set(state.payloadPtr, sub);
        const copyAmount = sub.byteLength;

        debugger;
        if (state.isMasked) {
            maskFn(state.payload, state.payloadPtr, copyAmount, state.mask);
        }

        state.payloadPtr += copyAmount;

        return copyAmount;
    }

    // TODO: We make the assumption that anyone who wants to use that data
    // has to copy it, and not us.
    //
    // TODO: Obviously there is no copying here.
    private pushFrame(state: WSState) {
        let buf = state.payload;

        if (state.payloads && state.payloads.length) {
            state.payloads.push(state.payload);

            // buf = Buffer.concat(state.payloads);
            buf = DataBuffer.concat(...state.payloads);
            state.payloads = undefined;
        }

        this.callbacks.forEach(cb => cb(buf, state));
    }
};

