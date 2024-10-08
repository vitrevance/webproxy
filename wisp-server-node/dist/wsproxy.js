"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWsProxy = handleWsProxy;
const node_net_1 = require("node:net");
async function handleWsProxy(ws, url) {
    const client = new node_net_1.Socket();
    try {
        const destination = url.split("/").pop().split(":");
        const host = destination[0];
        const port = parseInt(destination[1]);
        client.connect(port, host);
        client.on("data", (data) => {
            ws.send(data);
        });
        ws.onmessage = (event) => {
            client.write(event.data);
        };
        ws.onclose = () => {
            client.destroy();
        };
        client.on("close", () => {
            ws.close();
        });
    }
    catch (e) {
        ws.close();
        client.destroy();
    }
}
//# sourceMappingURL=wsproxy.js.map