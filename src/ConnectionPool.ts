import Url from "url-parse";
import { NetworkPipe, CreateTCPNetworkPipeOptions } from "./types";
import Platform from "./#{target}/Platform";
import { assert } from "./utils";

export interface ConnectionOptions {
    url: Url;
    freshConnect?: boolean;
    forbidReuse?: boolean;
    connectTimeout: number;
    dnsTimeout: number;
};

export interface PendingConnection {
    readonly id: number;

    abort(): void;
    then(func: (pipe: NetworkPipe) => void): Promise<any>;
}

class PendingConnectionImpl implements PendingConnection {
    private pool: ConnectionPool;
    private error?: string;
    private pipe?: NetworkPipe;
    private rejectFunction?: (reason: string) => void;
    private resolveFunction?: (pipe: NetworkPipe) => void;

    public hostname: string;
    public port: number;

    public dnsTimeout: number;
    public connectTimeout: number;


    constructor(pool: ConnectionPool, id: number, hostname: string,
                port: number, dnsTimeout: number, connectTimeout: number) {
        this.id = id;
        this.pool = pool;
        this.hostname = hostname;
        this.port = port;
        this.dnsTimeout = dnsTimeout;
        this.connectTimeout = connectTimeout;
    }

    readonly id: number;

    abort(): void {
        if (this.error || this.pipe) {
            throw new Error("Too late to abort pending connection");
        }
        this.pool.abort(this.id);
    }
    then(func: (pipe: NetworkPipe) => Promise<any>): Promise<any> {
        assert(!this.resolve);
        assert(!this.reject);
        return new Promise((resolve, reject) => {
            if (this.error) {
                reject(this.error);
                return;
            }

            if (this.pipe) {
                resolve(this.pipe);
                return;
            }

            this.resolveFunction = resolve;
            this.rejectFunction = reject;
        });
    }

    resolve(pipe: NetworkPipe): void {
        assert(!this.pipe);
        assert(!this.error);

        this.pipe = pipe;
        if (this.resolveFunction) {
            this.resolveFunction(pipe);
        }
    }

    reject(error: string): void {
        assert(!this.pipe);
        assert(!this.error);

        this.error = error;
        if (this.rejectFunction) {
            this.rejectFunction(error);
        }
    }
};

interface HostData {
    pipes: NetworkPipe[];
    initializing: number;
    pending: PendingConnectionImpl[];
    ssl: boolean;
};

export class ConnectionPool {
    private _id: number;
    private _maxPoolSize: number;
    private _maxConnectionsPerHost: number;
    private _hosts: Map<string, HostData>;
    private _pendingFreshConnects?: PendingConnection[];
    private _connectionCount: number;

    constructor() {
        this._id = 0;
        this._maxPoolSize = 0;
        this._maxConnectionsPerHost = 3;
        this._connectionCount = 0;
        this._hosts = new Map();
    }

    get maxPoolSize() {
        return this._maxPoolSize;
    }

    set maxPoolSize(value: number) {
        this._maxPoolSize = value;
    }

    abort(id: number): void {
        for (let [, value] of this._hosts) {
            if (value.pending) {
                for (let i = 0; i < value.pending.length; ++i) {
                    if (value.pending[i].id === id) {
                        value.pending.splice(i, 1);
                        return;
                    }
                }
            }
        }

        if (this._pendingFreshConnects) {
            for (let i = 0; i < this._pendingFreshConnects.length; ++i) {
                if (this._pendingFreshConnects[i].id === id) {
                    if (this._pendingFreshConnects.length === 1) {
                        this._pendingFreshConnects = undefined;
                    } else {
                        this._pendingFreshConnects.splice(i, 1);
                    }
                    return;
                }
            }
        }
        throw new Error("Can't find request to abort with id " + id);
    }

    finish(pipe: NetworkPipe): void {
        if (pipe.forbidReuse) {
            if (!pipe.closed) {
                pipe.close();
            }
            return;
        }
        const hostPort = `${pipe.hostname}:${pipe.port}`;
        let data = this._hosts.get(hostPort);
        if (!data) { // can this happen?
            data = { pipes: [], initializing: 0, pending: [], ssl: pipe.ssl };
            this._hosts.set(hostPort, data);
        }

        if (pipe.closed) {
            const idx = data.pipes.indexOf(pipe);
            assert(idx != -1);
            data.pipes.splice(idx, 1);
        } else {
            pipe.idle = true;
            data.pipes.push(pipe);
        }
        this.processHost(data);
    }

    // what to do for people who need to wait?, need an id
    requestConnection(options: ConnectionOptions): Promise<PendingConnection> {
        return new Promise((resolve, reject) => {
            let port: number = 0;
            if (options.url.port) {
                port = parseInt(options.url.port);
            }

            // Platform.trace("Request#send port", port);
            let ssl = false;
            switch (options.url.protocol) {
            case "https:":
            case "wss:":
                ssl = true;
                if (!port) {
                    port = 443;
                }
                break;
            default:
                if (!port)
                    port = 80;
                break;
            }

            const hostname = options.url.hostname;
            if (!hostname || port < 1 || port > 65535) {
                reject(new Error("Invalid url " + options.url));
                return;
            }

            const hostPort = `${hostname}:${port}`;
            let data = this._hosts.get(hostPort);

            if ((port == 80 && ssl) || (port == 443 && !ssl) || (data && data.ssl != ssl)) {
                // this is completely asinine but it's simple enough to allow
                options.freshConnect = true;
                options.forbidReuse = true;
            }

            const pending = new PendingConnectionImpl(this, ++this._id, hostname, port,
                                                      options.dnsTimeout, options.connectTimeout);
            if (this._id == Number.MAX_SAFE_INTEGER) {
                this._id = 0;
            }

            if (options.freshConnect) {
                // if (this._maxPoolSize > 0 && this._connectionCount >= this._maxPoolSize) {
                //     const pending = new PendingConnectionImpl(++this._id);
                //     if (this._id == Number.MAX_SAFE_INTEGER) {
                //         this._id = 0;
                //     }

                //     if (!this._pendingFreshConnects) {
                //         this._pendingFreshConnects = [];
                //     }
                //     this._pendingFreshConnects.push(pending);
                //     const prom = new Promise<PendingConnection>((resolve, reject) {
                //         pending.resolve = resolve;
                //         pending.reject = reject;
                //     });
                // }
            }

            if (!data) {
                data = { pipes: [], initializing: 0, pending: [], ssl: ssl };
                this._hosts.set(hostPort, data);
            }

            resolve(pending);
            data.pending.push(pending);
            this.processHost(data);
        });
    }

    // called when there's something to do and a pending
    private processHost(data: HostData): void {
        if (!data.pending.length)
            return;

        for (let i = 0; i < data.pipes.length; ++i) {
            assert(!data.pipes[i].closed, "This shouldn't be closed");
            if (data.pipes[i].idle) {
                data.pipes[i].idle = false;
                const pending = data.pending.shift();
                assert(pending);
                pending.resolve(data.pipes[i]);
                return;
            }
        }

        if (data.pipes.length + data.initializing < this._maxConnectionsPerHost) {
            const pending = data.pending.shift();
            assert(pending);
            const tcpOpts = {
                hostname: pending.hostname,
                port: pending.port,
                dnsTimeout: pending.dnsTimeout,
                connectTimeout: pending.connectTimeout,
                ipVersion: 4 // gotta do happy eyeballs and send off multiple tcp network pipe things
            } as CreateTCPNetworkPipeOptions;

            ++data.initializing;
            Platform.createTCPNetworkPipe(tcpOpts).then((pipe: NetworkPipe) => {
                if (data.ssl) {
                    return Platform.createSSLNetworkPipe({ pipe: pipe });
                } else {
                    return pipe;
                }
            }).then((pipe: NetworkPipe) => {
                pipe.idle = false;
                assert(data);
                --data.initializing;
                data.pipes.push(pipe);
                pending.resolve(pipe);
            }).catch((error: Error) => {
                --data.initializing;
                pending.reject(error.toString()); // should I reject with the error itself?
                this.processHost(data);
            });
        }
    }
}

export default new ConnectionPool;
