import { resolveConfigSource, type AlwaysOnConfigSource } from "../core/config.js";
import type { AlwaysOnDreamService } from "./service.js";

type LoggerLike = {
  warn: (message: string) => void;
};

export class AlwaysOnDreamScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private intervalMs: number | null = null;
  private readonly getConfig: ReturnType<typeof resolveConfigSource>;

  constructor(
    config: AlwaysOnConfigSource,
    private readonly dreamService: AlwaysOnDreamService,
    private readonly logger: LoggerLike,
  ) {
    this.getConfig = resolveConfigSource(config);
  }

  start(): void {
    this.refresh();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.intervalMs = null;
  }

  refresh(): void {
    const currentConfig = this.getConfig();
    if (!currentConfig.dreamEnabled) {
      this.stop();
      return;
    }

    const nextIntervalMs = Math.max(1, currentConfig.dreamIntervalMinutes) * 60 * 1000;
    if (this.timer && this.intervalMs === nextIntervalMs) {
      return;
    }

    this.stop();
    this.intervalMs = nextIntervalMs;
    this.timer = setInterval(() => {
      void this.tick();
    }, nextIntervalMs);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.dreamService.runScheduled();
    } catch (error) {
      this.logger.warn(`[clawx-always-on] Scheduled dream failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
