// Resolution shim: Node type-strips .ts but does not resolve extensionless
// specifiers (it expects NodeNext semantics). Vite/esbuild tolerates both.
// Register via: node --import ./scripts/ts-resolve.mjs <check>
import { register } from "node:module";
register("./ts-resolve-hooks.mjs", import.meta.url);
