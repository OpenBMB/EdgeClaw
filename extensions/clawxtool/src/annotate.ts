const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface AgeLabel {
  tag: string;
  category: "fresh" | "recent" | "aging" | "old" | "stale";
}

export function annotateAge(timestamp: Date, now?: Date, staleDays = 30): AgeLabel {
  const ref = now ?? new Date();
  const diffMs = ref.getTime() - timestamp.getTime();

  if (diffMs < 0) {
    return { tag: "[future timestamp]", category: "fresh" };
  }

  if (diffMs < HOUR) {
    const mins = Math.max(1, Math.floor(diffMs / MINUTE));
    return { tag: `[${mins}m ago]`, category: "fresh" };
  }

  if (diffMs < DAY) {
    const hours = Math.floor(diffMs / HOUR);
    return { tag: `[${hours}h ago]`, category: "recent" };
  }

  const days = Math.floor(diffMs / DAY);

  if (days < 7) {
    return { tag: `[${days}d ago]`, category: "aging" };
  }

  if (days < staleDays) {
    return { tag: `[${days}d ago - may be outdated]`, category: "old" };
  }

  return { tag: `[${days}d ago - likely stale]`, category: "stale" };
}

export function annotateMemoryBlock(
  block: string,
  timestamp: Date | string | undefined,
  staleDays: number,
  warnPrefix: string,
): string {
  if (!timestamp) return block;
  const ts = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (isNaN(ts.getTime())) return block;

  const { tag, category } = annotateAge(ts, undefined, staleDays);
  const prefix = category === "stale" || category === "old" ? `${warnPrefix} ${tag}` : tag;
  return `${prefix} ${block}`;
}
