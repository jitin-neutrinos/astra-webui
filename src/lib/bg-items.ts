export type BgItemStatus = "queued" | "running" | "done";
export type BgItemKind = "bg" | "steer";

export interface BgItem {
  id: number;
  kind: BgItemKind;
  text: string;
  status: BgItemStatus;
}

let nextBgId = 1;

export function createItem(kind: BgItemKind, text: string, isLive: boolean): BgItem {
  let status: BgItemStatus;
  if (kind === "steer") {
    status = "running";
  } else {
    status = isLive ? "queued" : "running";
  }
  return { id: nextBgId++, kind, text, status };
}

export function onTurnComplete(items: BgItem[]): BgItem[] {
  const nextItems = items.map(it => it.status === "running" ? { ...it, status: "done" as BgItemStatus } : it);
  const oldestQueuedIdx = nextItems.findIndex(it => it.status === "queued");
  if (oldestQueuedIdx !== -1) {
    nextItems[oldestQueuedIdx] = { ...nextItems[oldestQueuedIdx], status: "running" };
  }
  return nextItems;
}

export function reconcileWithServer(items: BgItem[], snapshot: { queued: { user: string } | null, running: boolean }): BgItem[] {
  if (!snapshot.running && !snapshot.queued) {
    // Server is fully idle: nothing queued, nothing executing. Any running item whose
    // completion frame was missed (back-to-back queue drains can race) is done by definition.
    return items.map(it => it.status !== "done" ? { ...it, status: "done" as BgItemStatus } : it);
  }
  if (snapshot.queued) {
    const qUser = snapshot.queued.user;
    const matchIdx = items.findIndex(it => it.status === "queued" && it.text === qUser);
    const firstQueuedIdx = items.findIndex(it => it.status === "queued");
    if (matchIdx !== -1 && matchIdx !== firstQueuedIdx) {
      const matchItem = items[matchIdx];
      const result: BgItem[] = [];
      let placedMatch = false;
      for (const it of items) {
        if (it.status === "queued") {
          if (!placedMatch) {
            result.push(matchItem);
            placedMatch = true;
          }
          if (it.id !== matchItem.id) {
            result.push(it);
          }
        } else {
          result.push(it);
        }
      }
      return result;
    }
  }
  return items;
}

export function dockVisible(items: BgItem[]): boolean {
  return items.length > 0;
}
