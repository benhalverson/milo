// @ts-ignore
import WebSocket from 'ws';
// @ts-ignore
import {WS} from '../dist/milo.node';
import autobahn from './runner';

// @ts-ignore
autobahn(WS, {
    updateReport: true
});


