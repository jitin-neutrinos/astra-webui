process.env.NTFY_URL = "http://127.0.0.1:9"; process.env.NTFY_TOPIC = "t"; process.env.NTFY_AUTH = "Basic x";
import fs from "fs";
const content = fs.readFileSync("./server/ntfy-notify.mjs", "utf8");
fs.writeFileSync("./server/ntfy-notify.mjs", content.replace('catch { /* never throw */ }', 'catch (e) { console.error(e); }'));
