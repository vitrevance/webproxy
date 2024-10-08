"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeRequest = routeRequest;
const Types_1 = require("./Types");
const Logger_1 = require("./Logger");
const ws_1 = __importDefault(require("ws"));
var node_net_1 = __importDefault(require("node:net"));
const node_dgram_1 = __importDefault(require("node:dgram"));
const Packets_1 = __importStar(require("./Packets"));
const wsproxy_1 = require("./wsproxy");
const promises_1 = __importDefault(require("node:dns/promises"));
const wss = new ws_1.default.Server({ noServer: true });
const defaultOptions = { logLevel: Types_1.LOG_LEVEL.INFO };
// Accepts either routeRequest(ws) or routeRequest(request, socket, head) like bare

exports.makeConnection = function (port, hostname) {
    const client = new node_net_1.default.Socket();
    client.connect(port, hostname);
    return client
}
async function routeRequest(wsOrIncomingMessage, socket, head, options = defaultOptions) {
    options = Object.assign({}, defaultOptions, options);
    if (!(wsOrIncomingMessage instanceof ws_1.default) && socket && head) {
        // Wsproxy is handled here because if we're just passed the websocket then we don't even know it's URL
        // Compatibility with bare like "handle upgrade" syntax
        wss.handleUpgrade(wsOrIncomingMessage, socket, head, (ws) => {
            if (!wsOrIncomingMessage.url?.endsWith("/")) {
                // if a URL ends with / then its not a wsproxy connection, its wisp
                (0, wsproxy_1.handleWsProxy)(ws, wsOrIncomingMessage.url);
                return;
            }
            routeRequest(ws, undefined, undefined, options);
        });
        return;
    }
    if (!(wsOrIncomingMessage instanceof ws_1.default))
        return; // something went wrong, abort
    const ws = wsOrIncomingMessage; // now that we are SURE we have a Websocket object, continue...
    const connections = new Map();
    const logger = new Logger_1.Logger(options.logLevel);
    ws.on("message", async (data, isBinary) => {
        try {
            // Ensure that the incoming data is a valid WebSocket message
            if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer)) {
                logger.error("Invalid WebSocket message data");
                return;
            }
            const wispFrame = Packets_1.default.wispFrameParser(Buffer.from(data));
            // Routing
            if (wispFrame.type === Types_1.CONNECT_TYPE.CONNECT) {
                // CONNECT frame data
                const connectFrame = Packets_1.default.connectPacketParser(wispFrame.payload);
                if (connectFrame.streamType === Types_1.STREAM_TYPE.TCP) {
                    // Initialize and register Socket that will handle this stream
                    const client = exports.makeConnection(connectFrame.port, connectFrame.hostname);
                    connections.set(wispFrame.streamID, {
                        client: client,
                        buffer: 127,
                    });
                    // Send Socket's data back to client
                    client.on("data", function (data) {
                        ws.send(Packets_1.default.dataPacketMaker(wispFrame, data));
                    });
                    // Close stream if there is some network error
                    client.on("error", function (err) {
                        logger.error(`An error occured in the connection to ${connectFrame.hostname} (${wispFrame.streamID}) with the message ${err.message}`);
                        ws.send(Packets_1.default.closePacketMaker(wispFrame, 0x03)); // 0x03 in the WISP protocol is defined as network error
                        connections.delete(wispFrame.streamID);
                    });
                    client.on("close", function () {
                        ws.send(Packets_1.default.closePacketMaker(wispFrame, 0x02));
                        connections.delete(wispFrame.streamID);
                    });
                }
                else if (connectFrame.streamType === Types_1.STREAM_TYPE.UDP) {
                    let iplevel = node_net_1.default.isIP(connectFrame.hostname); // Can be 0: DNS NAME, 4: IPv4, 6: IPv6
                    let host = connectFrame.hostname;
                    if (iplevel === 0) {
                        // is DNS
                        try {
                            host = (await promises_1.default.resolve(connectFrame.hostname))[0];
                            iplevel = node_net_1.default.isIP(host); // can't be 0 now
                        }
                        catch (e) {
                            logger.error("Failure while trying to resolve hostname " +
                                connectFrame.hostname +
                                " with error: " +
                                e);
                            ws.send(Packets_1.default.closePacketMaker(wispFrame, 0x42));
                            return; // we're done here, ignore doing anything to this message now.
                        }
                    }
                    // iplevel is now guaranteed to be 6 or 4, fingers crossed, so we can define the UDP type now
                    if (iplevel != 4 && iplevel != 6) {
                        return; // something went wrong.. neither ipv4 nor ipv6
                    }
                    // Create a new UDP socket
                    const client = node_dgram_1.default.createSocket(iplevel === 6 ? "udp6" : "udp4");
                    client.connect(connectFrame.port, host);
                    //@ts-expect-error stupid workaround
                    client.connected = false;
                    client.on("connect", () => {
                        //@ts-expect-error really dumb workaround
                        client.connected = true;
                    });
                    // Handle incoming UDP data
                    client.on("message", (data, rinfo) => {
                        ws.send(Packets_1.default.dataPacketMaker(wispFrame, data));
                    });
                    // Handle errors
                    client.on("error", (err) => {
                        logger.error(`An error occured in the connection to ${connectFrame.hostname} (${wispFrame.streamID}) with the message ${err.message}`);
                        ws.send(Packets_1.default.closePacketMaker(wispFrame, 0x03));
                        connections.delete(wispFrame.streamID);
                        client.close();
                    });
                    client.on("close", function () {
                        ws.send(Packets_1.default.closePacketMaker(wispFrame, 0x02));
                        connections.delete(wispFrame.streamID);
                    });
                    // Store the UDP socket and connectFrame in the connections map
                    connections.set(wispFrame.streamID, {
                        client,
                    });
                }
            }
            if (wispFrame.type === Types_1.CONNECT_TYPE.DATA) {
                const stream = connections.get(wispFrame.streamID);
                if (stream && stream.client instanceof node_dgram_1.default.Socket) {
                    stream.client.send(wispFrame.payload, undefined, undefined, (err) => {
                        if (err) {
                            ws.send(Packets_1.default.closePacketMaker(wispFrame, 0x03));
                            if (stream.client.connected) {
                                stream.client.close();
                            }
                            connections.delete(wispFrame.streamID);
                        }
                    });
                } else if (stream && stream.client) {
                    stream.client.write(wispFrame.payload);
                    stream.buffer--;
                    if (stream.buffer === 0) {
                        stream.buffer = 127;
                        ws.send((0, Packets_1.continuePacketMaker)(wispFrame, stream.buffer));
                    }
                }
            }
            if (wispFrame.type === Types_1.CONNECT_TYPE.CLOSE) {
                // its joever
                logger.log("Client decided to terminate with reason " + new DataView(wispFrame.payload.buffer).getUint8(0));
                const stream = connections.get(wispFrame.streamID);
                if (stream && stream.client instanceof node_dgram_1.default.Socket) {
                    stream.client.close();
                }
                else if (stream && stream.client) {
                    stream.client.destroy();
                }
                connections.delete(wispFrame.streamID);
            }
        }
        catch (e) {
            ws.close(); // something went SUPER wrong, like its probably not even a wisp connection
            logger.error(`WISP incoming message handler error: `, e);
            // cleanup
            for (const { client } of connections.values()) {
                if (client instanceof node_dgram_1.default.Socket) {
                    client.close();
                }
                else if (client) {
                    client.destroy();
                }
            }
            connections.clear();
        }
    });
    // Close all open sockets when the WebSocket connection is closed
    ws.on("close", (code, reason) => {
        logger.debug(`WebSocket connection closed with code ${code} and reason: ${reason}`);
        for (const { client } of connections.values()) {
            if (client instanceof node_dgram_1.default.Socket) {
                client.close();
            }
            else if (client) {
                client.destroy();
            }
        }
        connections.clear();
    });
    // SEND the initial continue packet with streamID 0 and 127 queue limit
    ws.send(Packets_1.default.continuePacketMaker({ streamID: 0 }, 127));
}
exports.default = {
    routeRequest,
};
//# sourceMappingURL=ConnectionHandler.js.map