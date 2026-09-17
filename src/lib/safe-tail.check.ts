import { safeTail } from "./safe-tail.ts";

function assertEq(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

// 9a
assertEq(safeTail("hi **bo"), "hi ");

// 9b
assertEq(safeTail("a\n| x | y |"), "a");

// 9c
assertEq(
  safeTail("| x | y |\n| --- | --- |\n| 1 | 2"),
  "| x | y |\n| --- | --- |"
);

// 9d
assertEq(safeTail("t\n```js\ncode"), "t\n```js\ncode\n```");
assertEq(safeTail("t\n```js\ncode\n"), "t\n```js\ncode\n```");

// 9e
assertEq(safeTail("a **b** c"), "a **b** c");

// 9f (GB3)
assertEq(safeTail("2 * 3 * 4"), "2 * 3 * 4");

console.log("ok");
