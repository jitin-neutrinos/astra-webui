import type { CanvasBlock } from "./canvas-schema";

export function numberMathFamily(blocks: CanvasBlock[]): Map<object, { family: "eq" | "thm" | "alg"; n: number }> {
  const map = new Map<object, { family: "eq" | "thm" | "alg"; n: number }>();
  let eqCounter = 0;
  let thmCounter = 0;
  let algCounter = 0;

  for (const b of blocks) {
    if (b.type === "math") {
      if (typeof b.number === "number") {
        eqCounter = b.number;
        map.set(b, { family: "eq", n: eqCounter });
      } else if ((b.number as any) !== false) {
        eqCounter++;
        map.set(b, { family: "eq", n: eqCounter });
      }
    } else if (b.type === "theorem") {
      if (typeof b.number === "number") {
        thmCounter = b.number;
        map.set(b, { family: "thm", n: thmCounter });
      } else if ((b.number as any) !== false) {
        thmCounter++;
        map.set(b, { family: "thm", n: thmCounter });
      }
    } else if (b.type === "algorithm") {
      if (typeof b.number === "number") {
        algCounter = b.number;
        map.set(b, { family: "alg", n: algCounter });
      } else if ((b.number as any) !== false) {
        algCounter++;
        map.set(b, { family: "alg", n: algCounter });
      }
    }
  }
  return map;
}
