import {
    AddrId,
    AddrInfoHints,

    NativeSocketInterface
} from '../types';

import {
    str2ab,
    ab2str
} from '../utils/index';

import onSelect from "../utils/onSelect";
import readline from 'readline';

var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

export default async function clientChat(bindings: NativeSocketInterface) {
    const {
        SOCK_STREAM,
        AF_INET,
        AI_PASSIVE,

        socket,
        getaddrinfo,
        connect,
        send,
        recv,
        accept,
        select,
        close,

        FD_CLR,
        FD_SET,
        FD_ZERO,
        FD_ISSET,

        newAddrInfo,
        isValidSocket,
        getErrorString,
        gai_strerror,
        addrInfoToObject,
    } = bindings;

    const addrHints: AddrInfoHints = {
        ai_socktype: SOCK_STREAM,
        ai_family: AF_INET
    };

    const hintsId = newAddrInfo(addrHints);
    const bindId = newAddrInfo();
    console.log("XXXX - localhost", "8080");
    const addrInfoResult =
        getaddrinfo(0, "8080", hintsId, bindId);

    if (addrInfoResult) {
        console.error("Unable to getaddrinfo.  Also stop using this method you dingus");
        return;
    }

    const bindData = addrInfoToObject(bindId);
    const socketId = socket(
        bindData.ai_family, bindData.ai_socktype, bindData.ai_protocol);

    console.log("Sacket id" , socketId);
    if (!isValidSocket(socketId)) {
        console.error("Unable to create the socket", getErrorString());
        return;
    }

    console.log("about to connect");
    const connectStatus = connect(socketId, bindId);
    console.log("connectStatus" , connectStatus);
    if (connectStatus) {
        console.error("Unable to connect to the socket", getErrorString());
        return;
    }

    // TODO: This interface kind of sucks...
    const buf = Buffer.alloc(4096);
    const fdSet = bindings.fd_set();

    while (true) {
        FD_ZERO(fdSet);
        FD_SET(socketId, fdSet);
        FD_SET(bindings.STDIN_FILENO, fdSet);

        await onSelect(select, socketId, fdSet);

        if (FD_ISSET(socketId, fdSet)) {
            const len = bindings.recv(socketId, buf, buf.byteLength);
            console.log(ab2str(buf.slice(0, len)));
        }

        else if (FD_ISSET(bindings.STDIN_FILENO, fdSet)) {
            const len = bindings.readstdin(buf, buf.byteLength);
            console.log("XXXX", len, ab2str(buf.slice(0, len)));
            bindings.send(socketId, buf, len);
        }
    }
};








