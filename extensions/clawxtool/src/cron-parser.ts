interface CronField {
  values: Set<number>;
}

function parseField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const trimmed = part.trim();

    if (trimmed === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    const stepMatch = trimmed.match(/^(\S+)\/(\d+)$/);
    if (stepMatch) {
      const [, range, stepStr] = stepMatch;
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;

      if (range !== "*") {
        const dashMatch = range.match(/^(\d+)-(\d+)$/);
        if (dashMatch) {
          start = parseInt(dashMatch[1], 10);
          end = parseInt(dashMatch[2], 10);
        } else {
          start = parseInt(range, 10);
          end = max;
        }
      }

      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }

    const dashMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (dashMatch) {
      const start = parseInt(dashMatch[1], 10);
      const end = parseInt(dashMatch[2], 10);
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= min && num <= max) {
      values.add(num);
    }
  }

  return { values };
}

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseField(parts[0], 0, 59).values,
    hours: parseField(parts[1], 0, 23).values,
    daysOfMonth: parseField(parts[2], 1, 31).values,
    months: parseField(parts[3], 1, 12).values,
    daysOfWeek: parseField(parts[4], 0, 6).values,
  };
}

export function nextOccurrences(expression: string, count: number, from?: Date): Date[] {
  const cron = parseCron(expression);
  const results: Date[] = [];
  const start = from ? new Date(from) : new Date();

  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const maxIterations = 525_960; // ~1 year of minutes
  let current = new Date(start);

  for (let i = 0; i < maxIterations && results.length < count; i++) {
    if (
      cron.months.has(current.getMonth() + 1) &&
      cron.daysOfMonth.has(current.getDate()) &&
      cron.daysOfWeek.has(current.getDay()) &&
      cron.hours.has(current.getHours()) &&
      cron.minutes.has(current.getMinutes())
    ) {
      results.push(new Date(current));
    }

    current.setMinutes(current.getMinutes() + 1);
  }

  return results;
}

export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [min, hour, dom, mon, dow] = parts;
  const pieces: string[] = [];

  if (min !== "*") pieces.push(`minute ${min}`);
  if (hour !== "*") pieces.push(`hour ${hour}`);
  if (dom !== "*") pieces.push(`day-of-month ${dom}`);
  if (mon !== "*") pieces.push(`month ${mon}`);
  if (dow !== "*") {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const resolved = dow.replace(/\d/g, (d) => dayNames[parseInt(d, 10)] ?? d);
    pieces.push(`day-of-week ${resolved}`);
  }

  return pieces.length > 0 ? pieces.join(", ") : "every minute";
}
