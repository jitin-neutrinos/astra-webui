import { catalogRequest } from "./session-files.ts";

const a = catalogRequest(1000);
const b = catalogRequest(1001);
if (a.url === b.url) throw new Error("catalog url must change so a pinned copy cannot answer");
if (!a.url.startsWith("/api/hx/model/options?live=")) throw new Error("unexpected catalog url " + a.url);
if (a.init.cache !== "no-store") throw new Error("catalog fetch must bypass the HTTP cache");
if (a.init.credentials !== "same-origin") throw new Error("catalog fetch must send the session cookie");

console.log("ok");
