#!/usr/bin/env node
import { request } from "node:http";

const password = process.env.ASTRA_WEBUI_PASSWORD;
if (!password) {
  console.error("ASTRA_WEBUI_PASSWORD not set");
  process.exit(1);
}

const PORT = Number(process.env.ASTRA_WEBUI_PORT || 3011);

function login() {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/login",
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, res => {
      let cookie = res.headers["set-cookie"]?.find(c => c.startsWith("astra_session="));
      if (!cookie) return reject(new Error("No session cookie"));
      resolve(cookie.split(";")[0]);
    });
    req.on("error", reject);
    req.write(JSON.stringify({ password }));
    req.end();
  });
}

async function run() {
  console.log("Logging in...");
  const cookie = await login();
  
  console.log("Connecting WS...");
  const key = Buffer.from(Math.random().toString()).toString("base64");
  const req = request({
    hostname: "127.0.0.1",
    port: PORT,
    path: "/api/hx/ws?sid=reaptest",
    headers: {
      "Connection": "Upgrade",
      "Upgrade": "websocket",
      "Sec-WebSocket-Key": key,
      "Sec-WebSocket-Version": "13",
      "Cookie": cookie
    }
  });

  const t0 = Date.now();
  const wsWait = new Promise((resolve, reject) => {
    req.on("upgrade", (res, socket) => {
      console.log("WS connected, waiting for reap (max 100s)...");
      let closed = false;
      socket.on("close", () => {
        closed = true;
        console.log(`Socket closed by server after ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
        resolve();
      });
      socket.on("error", () => {});
      // Without a consumer the buffered ping/tick frames delay EOF delivery —
      // the close event never fires and the check false-fails. Drain the stream.
      socket.resume();
      
      // never pong back, wait for server to reap
      setTimeout(() => {
        if (!closed) {
          console.error(`Socket was not reaped within 100s! (elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
          process.exit(1);
        }
      }, 100_000);
    });
    req.on("response", res => {
      reject(new Error("Upgrade failed: " + res.statusCode));
    });
    req.on("error", reject);
  });
  
  req.end();
  await wsWait;
  console.log("ws-reap-check passed.");
  process.exit(0);
}

run().catch(err => {
  console.error("ws-reap-check failed:", err);
  process.exit(1);
});
