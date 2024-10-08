import { WispOptions } from "./Types";
import WebSocket from "ws";
import { Socket } from "node:net";
import { IncomingMessage } from "node:http";
export declare function routeRequest(wsOrIncomingMessage: WebSocket | IncomingMessage, socket?: Socket, head?: Buffer, options?: WispOptions): Promise<void>;
declare const _default: {
    routeRequest: typeof routeRequest;
};
export default _default;
