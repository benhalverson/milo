import http2 from 'http2';
import express from 'express';

import { Request } from '../../Request';
import { http2Upgrade }from '../index';

describe("HTTP2 integration test", function() {

    it('should setup a http2 server and create a connection to it.', async function(done) {
        const server = http2.createServer();

        server.on('error', (err) => console.error(err));
        server.on('stream', (stream, headers) => {
            // stream is a Duplex
            stream.respond({
                'content-type': 'text/html',
                ':status': 200
            });
            stream.end('<h1>Hello World</h1>');
        });
        server.listen(8000);

        // create the http2 upgrade request
        const pipe = await http2Upgrade({url: 'http://localhost:8000/'});
    });
});
