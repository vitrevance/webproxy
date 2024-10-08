"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ConnectionHandler_1 = __importDefault(require("./ConnectionHandler"));
const node_http_1 = __importDefault(require("node:http"));
const httpServer = node_http_1.default.createServer().listen(process.env.PORT || 3000);
httpServer.on("upgrade", (req, socket, head) => {
    ConnectionHandler_1.default.routeRequest(req, socket, head);
});
//# sourceMappingURL=createServer.js.map