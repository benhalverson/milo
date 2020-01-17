import dns from "dns";

import { toUint8Array } from './utils';
import { DnsResult, IpVersion, Platform, NetworkPipe } from "../types";
import createTCPNetworkPipe from "./NodeTCPNetworkPipe";

import sha1 from "sha1";
import btoa from "btoa";
import atob from "atob";

function bufferToString(buf: Uint8Array | ArrayBuffer): string {
    if (buf instanceof Uint8Array) {
        return String.fromCharCode.apply(null, buf);
    }

    return String.fromCharCode.apply(null, new Uint8Array(buf));
}

class NodePlatform implements Platform {
    constructor() {}

    // One down, 40 to go
    sha1(input: string): Uint8Array {
        const str = sha1(input);
        return toUint8Array(str);
    }

    // base64 encode
    // fixme? anders....
    // @ts-ignore
    btoa(buffer: Uint8Array|ArrayBuffer|string, returnUint8Array: boolean): string | Uint8Array {
        let out;
        if (typeof buffer === 'string') {
            out = btoa(buffer);
        }
        else {
            const buf = Buffer.from(buffer);
            out = btoa(buf);
        }

        if (returnUint8Array) {
            return toUint8Array(out);
        }

        return out;
    }

    // base64 decode
    // @ts-ignore
    atob(buffer: Uint8Array|ArrayBuffer|string, returnUint8Array: false|undefined): string | Uint8Array {
        let out;
        if (typeof buffer === 'string') {
            out = atob(buffer);
        }
        else {
            out = atob(Buffer.from(buffer).toString());
        }

        if (returnUint8Array) {
            return toUint8Array(out);
        }

        return out;
    }

    // string to uint8array
    atoutf8(input: Uint8Array | ArrayBuffer | string): Uint8Array {
        return toUint8Array(input);
    }

    // TODO: Assumes Ascii
    utf8toa(input: Uint8Array | ArrayBuffer | string, offset?: number, length?: number): string {
        if (typeof input === 'string') {
            return input.substr(offset, length);
        }

        let buf: Uint8Array;
        if (input instanceof ArrayBuffer) {
            buf = new Uint8Array(input);
        }
        else {
            buf = input;
        }

        return String.fromCharCode.apply(null, buf);
    }

    randomBytes(len: number): Uint8Array {
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; ++i) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
        return bytes;
    }

    assert(cond: any, message?: string): void {
        if (process.env.NODE_ENV === 'development') {
            if (!cond) {
                throw new Error(message ? message : 'You dun messed up.');
            }
        }
    }

    log(...args: any[]): void {
        console.log.apply(console, args);
    }

    createTCPNetworkPipe(hostOrIpAddress: string, port: number): Promise<NetworkPipe> {
        return new Promise((res, rej) => {

        });
    }

    concatBuffers(...args: ArrayBuffer[] | Uint8Array[]): ArrayBuffer {
        let bufs;

        if (args[0] instanceof ArrayBuffer) {
            // @ts-ignore
            bufs = args.map(x => new Uint8Array(x));
        }
        else {
            bufs = args;
        }

        const concattedBuf = Buffer.concat(bufs);
        const offset = concattedBuf.byteOffset;
        return concattedBuf.buffer.slice(offset, offset + concattedBuf.length);
    }

    // "heremybigHHTTP string\r\n"
    bufferIndexOf(haystack: Uint8Array | ArrayBuffer | string, haystackOffset: number, haystackLength: number|undefined, needle: Uint8Array | ArrayBuffer | string, needleOffset?: number, needleLength?: number|undefined): number {

        const needleStr = typeof needle === 'string' ?
            needle : bufferToString(needle);

        if (typeof haystack === 'string') {
            return haystack.
                substr(haystackOffset, haystackLength).
                indexOf(needleStr.substr(needleOffset, needleLength));
        }

        const buffer = Buffer.from(haystack).
                slice(haystackOffset, haystackOffset + haystackLength);

        if (typeof needle === 'string') {
            return buffer.
                indexOf(needle.substr(needleOffset, needleLength));
        }

        const needleBuf: Uint8Array  = toUint8Array(needle).
            subarray(needleOffset, needleOffset + needleLength);

        return buffer.indexOf(needleBuf);
    }

    bufferLastIndexOf(haystack: Uint8Array | ArrayBuffer | string, haystackOffset: number, haystackLength: number|undefined, needle: Uint8Array | ArrayBuffer | string, needleOffset?: number, needleLength?: number|undefined): number {
        const needleStr = typeof needle === 'string' ?
            needle : bufferToString(needle);

        if (typeof haystack === 'string') {
            return haystack.
                substr(haystackOffset, haystackLength).
                lastIndexOf(needleStr.substr(needleOffset, needleLength));
        }

        const buffer = Buffer.from(haystack).
            slice(haystackOffset, haystackOffset + haystackLength);

        if (typeof needle === 'string') {
            return buffer.
                lastIndexOf(needle.substr(needleOffset, needleLength));
        }

        const needleBuf: Uint8Array  = toUint8Array(needle).
            subarray(needleOffset, needleOffset + needleLength);

        return buffer.lastIndexOf(needleBuf);
    }

    lookupDnsHost(host: string, ipVersion: IpVersion, timeout: number, callback: (result: DnsResult) => void): void {
        dns.lookup(host, {
            family: ipVersion
        }, (err, address, family) => {
            const res = { } as DnsResult;
            if (err) {
                res.errorCode = err.errno;
                res.error = err.message;
                return res;
            }

            res.host = address;
            res.addresses = [address];

            // @ts-ignore
            // we don't worry about ipv5
            res.ipVersion = family;
            res.type = "i don't know.";

            callback(res);
        });
    }
}

export default new NodePlatform();
