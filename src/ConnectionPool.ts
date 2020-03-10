import Url from "url-parse";
import { NetworkPipe } from "./types";
import { assert } from "./utils";


export interface ScheduleOptions {
    url: string;
    freshConnect?: boolean;
    forbidReuse?: boolean;
};

export interface PendingConnection {
    readonly id: number;

    abort(): void;
    onConnection(): Promise<NetworkPipe>;
}

class PendingConnectionImpl implements PendingConnection {
    constructor(id: number) {
        this.id = id;
    }

    readonly id: number;

    reject?: (reason: string) => void;
    resolve?: (pipe: NetworkPipe) => void;

    abort(): void {


    }
    onConnection(): Promise<NetworkPipe> {
        assert(this.resolve);
        assert(this.reject);
        return new Promise((resolve, reject) => {


        });
        // this.resolve.then(
    }
};

class ConnectionData {
    busy: NetworkPipe[];
    ready: NetworkPipe[];
    pending: PendingConnection[];

    constructor() {
        this.busy = [];
        this.ready = [];
        this.pending = [];
    }
};

class ConnectionPool {
    private _id: number;
    private _maxPoolSize: number;
    private _maxConnectionsPerHost: number;
    private _connections: Map<string, ConnectionData>;
    private _pendingFreshConnects?: PendingConnection[];
    private _connectionCount: number;

    constructor() {
        this._id = 0;
        this._maxPoolSize = 0;
        this._maxConnectionsPerHost = 3;
        this._connectionCount = 0;
        this._connections = new Map();
    }

    get maxPoolSize() {
        return this._maxPoolSize;
    }

    set maxPoolSize(value: number) {
        this._maxPoolSize = value;
    }

    // what to do for people who need to wait?, need an id
    requestConnection(options: ScheduleOptions): Promise<NetworkPipe | PendingConnection> {
        const url = new Url(options.url);

        let port: number = 0;
        if (url.port) {
            port = parseInt(url.port);
        }

        // Platform.trace("Request#send port", port);
        let ssl = false;
        switch (url.protocol) {
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
        if ((port == 80 && ssl) || (port == 443 && !ssl)) {
            // this is completely asinine but it's simple enough to allow
            options.freshConnect = true;
            options.forbidReuse = true;
        }

        const hostPort = `${url.host}:${port}`;

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

        let data = this._connections.get(hostPort);
        if (!data) {
            data = new ConnectionData;
            this._connections.set(hostPort, data);
        }
        // if (data.ready
        // }
        return new Promise((resolve, reject) => {


        });
    }
}
