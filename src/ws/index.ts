import WSFramer from './framer';
import { WSState } from './framer/types';
import Platform from "../#{target}/Platform";
import DataBuffer from "../#{target}/DataBuffer";
import { Request, RequestData, RequestResponse } from "../Request";
import { headerValue } from "../utils";

import {
    NetworkPipe,
    IDataBuffer,
} from '../types';

import {
    Opcodes,
    WSOptions
} from './types';

const defaultOptions = {
    maxFrameSize: 8192,
    poolInternals: false,
    noCopySentBuffers: false,
    eventWrapper: true,
} as WSOptions;

const readView = new DataBuffer(16 * 1024);

export {
    WSState
};

type AnyCallback = ((...args: any[]) => void);
export type CallbackNames = "message" | "close" | "open" | "error";
export type CloseCallback = ((code: number, buf: IDataBuffer) => void);
export type ErrorCallback = ((code: number, message: string) => void);
export type OpenCallback = (() => void);
export type MessageCallback = ((buf: IDataBuffer) => void);

export type CallbackMap = {
    message: MessageCallback[];
    close: CloseCallback[];
    open: OpenCallback[];
    error: ErrorCallback[];
};

export enum ConnectionState {
    Connecting = 1,
    Connected = 2,
    Closed = 3,
};

export type UrlObject = {
    host: string,
    port: string | number
}

function _wsUpgrade(u: string | UrlObject): Promise<NetworkPipe> {
    let url = u;
    if (typeof url === "object") {
        // TODO: Should I do this?
        url = `ws://${url.host}:${url.port}`;
    }

    const data: RequestData = { forbidReuse: true, url, format: "databuffer" };

    return new Promise((resolve, reject) => {
        if (!data.headers) {
            data.headers = {};
        }

        // TODO: Ask Jordan, WHY TYPESCRIPT WHY...
        const arrayBufferKey = new DataBuffer(16);

        arrayBufferKey.randomize();
        const key = arrayBufferKey.toString("base64");


        Platform.trace("key is", key, arrayBufferKey);
        data.headers["Upgrade"] = "websocket";
        data.headers["Connection"] = "Upgrade";
        data.headers["Sec-WebSocket-Key"] = key;
        data.headers["Sec-WebSocket-Version"] = "13";
        data.forbidReuse = true;
        data.freshConnect = true;
        const req = new Request(data);
        req.send().then(response => {
            Platform.trace("Got response", response);
            if (response.statusCode !== 101)
                throw new Error("status code");

            const upgradeKeyResponse = headerValue(response.headers, "sec-websocket-accept");
            if (!upgradeKeyResponse)
                throw new Error("no Sec-WebSocket-Accept key");

            const WS_KEY = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
            const shadkey = Platform.btoa(Platform.sha1(key + WS_KEY));
            if (shadkey !== upgradeKeyResponse)
                throw new Error(`Key mismatch expected: ${shadkey} got: ${upgradeKeyResponse}`);

            Platform.trace("successfully upgraded");

            debugger
            // houstone we have a problem
            // TODO: Come back to this...
            // @ts-ignore
            resolve(req.networkPipe);
        }).catch(error => {
            Platform.trace("Got error", error);
            reject(error);
        });
    });
}


export default class WS {
    // @ts-ignore
    private frame: WSFramer;
    // @ts-ignore
    private pipe: NetworkPipe;

    private callbacks: CallbackMap;
    private state: ConnectionState;
    private opts: WSOptions;

    public onmessage?: MessageCallback;
    public onclose?: CloseCallback;
    public onopen?: OpenCallback;
    public onerror?: ErrorCallback;

    constructor(url: string | UrlObject, opts: WSOptions = defaultOptions) {
        // pipe: NetworkPipe, opts: WSOptions = defaultOptions) {
        this.state = ConnectionState.Connecting;
        this.opts = opts;

        this.callbacks = {
            message: [],
            close: [],
            open: [],
            error: [],
        };

        this.connect(url);
    }

    private readyEvent(msg: string | IDataBuffer, state?: WSState) {
        if (typeof msg === 'string') {
            return msg;
        }

        let payload: string | IDataBuffer = msg;
        if (state && state.opcode === Opcodes.TextFrame) {
            payload = Platform.utf8toa(msg);
        }

        // TODO: What other dumb things do I need to add to this?
        if (this.opts.eventWrapper) {
            return {
                data: payload
            };
        }

        return payload;
    }

    private async connect(url: string | UrlObject) {
        const pipe = await _wsUpgrade(url)
        const {
            message,
            close,
            open,
            error,
        } = this.callbacks;

        this.frame = new WSFramer(pipe, this.opts.maxFrameSize);
        this.pipe = pipe;

        pipe.onerror = (code: number, message: string): void => {
            if (this.onerror) {
                this.onerror(code, message);
            }

            this.callCallback(error, this.onerror, code, message);
        };

        pipe.onclose = () => {
            if (this.state === ConnectionState.Closed) {
                return;
            }
            this.state = ConnectionState.Closed;
            this.callCallback(close, this.onclose, 1000, null);
        }


        // The pipe is ready to read.
        const readData = () => {
            debugger
            let bytesRead;
            while (1) {

                bytesRead = pipe.read(readView, 0, readView.byteLength);
                if (bytesRead <= 0) {
                    break;
                }

                this.frame.processStreamData(readView, 0, bytesRead);
            }
        }

        pipe.ondata = readData;

        this.frame.onFrame((buffer: IDataBuffer, state: WSState) => {
            switch (state.opcode) {
            case Opcodes.CloseConnection:
                this.state = ConnectionState.Closed;
                const code = buffer.getUInt16BE(0);
                const restOfData = buffer.subarray(2);

                this.callCallback(close, this.onclose, code, restOfData);

                // attempt to close the sockfd.
                this.pipe.close();

                break;

            case Opcodes.Ping:
                this.frame.send(buffer, 0, buffer.byteLength, Opcodes.Pong);
                break;

            case Opcodes.BinaryFrame:
            case Opcodes.TextFrame:
                const out = this.readyEvent(buffer, state);
                this.callCallback(message, this.onmessage, out);
                break;

            default:
                throw new Error("Can you handle this?");
            }
        });

        this.callCallback(open, this.onopen);

        // reads any data that is still present in the pipe.
        readData();
    }

    ping() {
    }

    private callCallback(callbacks: AnyCallback[],
                         secondCallback: AnyCallback | undefined, arg1?: any, arg2?: any) {

        try {
            if (secondCallback) {
                secondCallback(arg1, arg2);
            }

            for (let i = 0; i < callbacks.length; ++i) {
                callbacks[i](arg1, arg2);
            }
        } catch (e) {
            Platform.trace("Error on callbacks", e);
        }
    }

    // Don't know how to do this well...
    on(callbackName: CallbackNames, callback: (...args: any[]) => void) {
        this.callbacks[callbackName].push(callback);
    }

    off(callbackName: CallbackNames, callback: (...args: any[]) => void) {
        const cbs = this.callbacks[callbackName];
        const idx = cbs.indexOf(callback);
        if (~idx) {
            cbs.splice(idx, 1);
        }
    }

    sendJSON(obj: object) {
        this.send(JSON.stringify(obj));
    }

    send(obj: IDataBuffer | Uint8Array | string) {

        let bufOut: IDataBuffer;
        let len;
        let opcode = Opcodes.BinaryFrame;

        if (obj instanceof Uint8Array) {
            bufOut = new DataBuffer(obj);
            opcode = Opcodes.BinaryFrame;
        }

        else if (obj instanceof DataBuffer) {
            bufOut = obj;
            opcode = Opcodes.BinaryFrame;
        }

        else {
            bufOut = new DataBuffer(obj);
            opcode = Opcodes.TextFrame;
        }

        this.frame.send(bufOut, 0, bufOut.byteLength, opcode);
    }
}
