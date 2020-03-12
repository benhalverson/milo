import Platform from "./#{target}/Platform";
import DataBuffer from "./#{target}/DataBuffer";
import { IDataBuffer } from "./types";

export function headerValue(headers: string[], header: string): string {
    const lower = header.toLowerCase() + ": ";
    for (let i = 0; i < headers.length; ++i) {
        const h = headers[i].toLowerCase();
        if (h.lastIndexOf(lower, 0) === 0) {
            return headers[i].substring(lower.length);
        }
    }
    return "";
}

export function assert(condition: any, msg?: string): asserts condition {
    if (!condition) {
        Platform.assert(condition, msg);
    }
}

export function escapeData(data: Uint8Array | ArrayBuffer | IDataBuffer | string, offset?: number, length?: number): string {
    if (typeof data !== "string") {
        data = Platform.utf8toa(data, offset || 0, length);
    } else if (offset && !length) {
        data = data.substr(offset);
    } else if (length) {
        data = data.substr(offset || 0, length);
    }
    return data.replace(/\r/g, "\\r").replace(/\n/g, "\\n\n");
}

export type PoolItem<T> = {free: () => void, item: T};
export type PoolFreeFunction<T> = (item: PoolItem<T>) => void;
export type PoolFactory<T> = (freeFn: PoolFreeFunction<T>) => PoolItem<T>;

export class Pool<T> {
    private factory: PoolFactory<T>;
    private pool: PoolItem<T>[];
    private boundFree: PoolFreeFunction<T>;

    constructor(factory: PoolFactory<T>) {
        this.factory = factory;
        this.pool = [];
        this.boundFree = this.free.bind(this);
    }

    get() {
        if (this.pool.length === 0) {
            this.pool.push(this.factory(this.boundFree));
        }
        return this.pool.pop();
    }

    private free(item: PoolItem<T>) {
        this.pool.push(item);
    }
};

export function createDataBufferPool(size: number) {
    function factory(freeFn: PoolFreeFunction<IDataBuffer>): PoolItem<IDataBuffer> {
        const buf = new DataBuffer(size);
        const poolItem = {
            item: buf,
            free: () => {
                freeFn(poolItem);
            }
        };

        return poolItem;
    }
    return new Pool<IDataBuffer>(factory);
}
