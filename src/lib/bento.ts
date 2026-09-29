// Pure bento layout picker (R3). n counts GRID items (audio excluded — audio renders rows below).
export type Bento = { cls: "mg-0" | "mg-1" | "mg-2" | "mg-3" | "mg-4" | "mg-5"; visible: number; overflow: number };

export const AREAS = ["a", "b", "c", "d", "e"] as const;

export function bentoLayout(n: number): Bento {
  if (n <= 0) return { cls: "mg-0", visible: 0, overflow: 0 };
  if (n <= 5) return { cls: `mg-${n}` as Bento["cls"], visible: n, overflow: 0 };
  return { cls: "mg-5", visible: 5, overflow: n - 5 };
}
