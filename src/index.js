import express from "express";
import { createServer } from "node:http";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { join } from "node:path";
import { hostname } from "node:os";
import { SocksClient } from 'socks';
import wisp from "../wisp-server-node/dist/ConnectionHandler.js"
import { log } from "node:console";
import { fileURLToPath } from "url";


const proxy = {
  host: process.env.SOCKS_HOST, // ipv4 or ipv6 or hostname
  port: parseInt(process.env.SOCKS_PORT),
  type: 5 // Proxy version (4 or 5)
}

wisp.makeConnection = function (port, hostname) {
  const options = {
    proxy: proxy,

    command: 'connect',

    destination: {
      host: hostname,
      port: port
    }
  };
  let pipe = {
    socket: null,
    queue: [],
    error: null,
  }
  log('connect: ' + hostname + ':' + port)
  SocksClient.createConnection(options)
    .then(function (connection) {
      pipe.socket = connection.socket;
      // pipe.socket.on('error', function (err) { log('error: ' + err) });
      // pipe.socket.on('close', function () { log('close') });
      // let total = 0
      // pipe.socket.on('data', function (data, ignore) {
      //   total += data.length;
      //   log('recvd: ' + total)
      // });
      for (let i = 0; i < pipe.queue.length; i++) {
        pipe.queue[i]();
      }
      pipe.queue = null
    })
    .catch(function (err) {
      if (pipe.error == null) {
        pipe.error = err;
      } else {
        pipe.error(err)
      }
    });
  pipe.on = function (name, callback) {
    if (pipe.socket != null) {
      pipe.socket.on(name, callback)
    } else {
      pipe.queue.push(function () {
        pipe.socket.on(name, callback);
      })
      if (name == 'error') {
        if (pipe.error != null) {
          callback(pipe.error);
        } else {
          pipe.error = callback;
        }
      }
    }
  };
  pipe.write = function (data) {
    if (pipe.socket != null) {
      pipe.socket.write(data);
    } else {
      pipe.queue.push(function () {
        pipe.socket.write(data)
      })
    }
  };
  pipe.destroy = function () {
    if (pipe.socket != null) {
      pipe.socket.destroy();
    } else {
      pipe.queue.push(function () {
        pipe.socket.destroy()
      })
    }
  };
  return pipe;
}

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

const app = express();
// Load our publicPath first and prioritize it over UV.
app.use(express.static(publicPath));
// Load vendor files last.
// The vendor's uv.config.js won't conflict with our uv.config.js inside the publicPath directory.
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/baremux/", express.static(baremuxPath));

// Error for everything else
app.use((req, res) => {
  res.status(404);
  res.sendFile(join(publicPath, "404.html"));
});

const server = createServer();

server.on("request", (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  app(req, res);
});
server.on("upgrade", (req, socket, head) => {
  if (req.url.endsWith("/wisp/"))
    wisp.routeRequest(req, socket, head);
  else
    socket.end();
});

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

server.on("listening", () => {
  const address = server.address();

  // by default we are listening on 0.0.0.0 (every interface)
  // we just need to list a few
  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
  console.log(
    `\thttp://${address.family === "IPv6" ? `[${address.address}]` : address.address
    }:${address.port}`
  );
  console.log(`With socks5: ${process.env.SOCKS_HOST}:${process.env.SOCKS_PORT}`);
});

// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  process.exit(0);
}

server.listen({
  port,
});
