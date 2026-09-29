// Slash-command parser checks. Run: npx tsx src/lib/slash-commands.check.ts
import { parseCommand } from "./slash-commands.ts";

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
}

ok(parseCommand("/bg run the tests").kind === "bg", "/bg parses");
ok(parseCommand("/bg run the tests").text === "run the tests", "/bg carries payload");
ok(parseCommand("/steer focus on the parser").kind === "steer", "/steer parses");
ok(parseCommand("/steer focus on the parser").text === "focus on the parser", "/steer carries payload");
ok(parseCommand("  /bg   spaced payload  ").text === "spaced payload", "whitespace trimmed both sides");
ok(parseCommand("/bg multiline\npayload").kind === "bg", "multiline payload kept");
// bare commands and unknown slashes are plain text
ok(parseCommand("/bg").kind === "plain", "bare /bg is plain");
ok(parseCommand("/steer").kind === "plain", "bare /steer is plain");
ok(parseCommand("/bg ").kind === "plain", "/bg + trailing space only is plain");
ok(parseCommand("/model gpt-5").kind === "plain", "/model stays plain (gateway slash)");
ok(parseCommand("/bgx nope").kind === "plain", "/bgx is not /bg");
ok(parseCommand("hello /bg world").kind === "plain", "mid-text /bg is not a command");
ok(parseCommand("").kind === "plain", "empty is plain");

if (failures) { console.error(`${failures} check(s) failed`); throw new Error(`${failures} slash-commands check(s) failed`); }
console.log("PASS: slash-commands checks");
