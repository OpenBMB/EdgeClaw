import type { SubagentExecutor } from "../executor/executor.js";
import type { PluginLoggerSink } from "../storage/logger.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";

const DEFAULT_POLL_INTERVAL_MS = 1_000;

export class AlwaysOnWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private processing = false;
  private maxConcurrentTasks: number;

  constructor(
    private readonly store: TaskStore,
    private readonly logger: TaskLogger,
    private readonly executor: SubagentExecutor,
    private readonly hostLogger?: PluginLoggerSink,
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxConcurrentTasks = 1,
  ) {
    this.maxConcurrentTasks = maxConcurrentTasks;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.requeueLaunchingTasks();
    void this.processQueue();

    this.timer = setInterval(() => {
      void this.processQueue();
    }, this.pollIntervalMs);
    this.timer.unref?.();

    this.hostLogger?.info(
      `[clawx-always-on] worker started (maxConcurrentTasks=${this.maxConcurrentTasks})`,
    );
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.hostLogger?.info("[clawx-always-on] worker stopped");
  }

  updateMaxConcurrentTasks(maxConcurrentTasks: number): void {
    this.maxConcurrentTasks = maxConcurrentTasks;
    this.hostLogger?.info(
      `[clawx-always-on] worker concurrency updated (maxConcurrentTasks=${this.maxConcurrentTasks})`,
    );
    if (this.running) {
      void this.processQueue();
    }
  }

  private requeueLaunchingTasks(): void {
    const launchingTasks = this.store.listTasks({ status: "launching" });
    for (const task of launchingTasks) {
      this.store.updateTask(task.id, { status: "queued" });
      this.logger.warn(
        task.id,
        "Recovered task stuck in launching state; re-queued on worker start",
      );
    }
  }

  private async processQueue(): Promise<void> {
    if (!this.running || this.processing) {
      return;
    }

    this.processing = true;
    try {
      const queuedTasks = this.store.getQueuedTasks();
      for (const task of queuedTasks) {
        if (!this.running) {
          break;
        }
        if (this.store.countRunningTasks() >= this.maxConcurrentTasks) {
          break;
        }
        if (!this.store.claimQueuedTask(task.id)) {
          continue;
        }

        this.logger.info(task.id, "Worker picked queued task");

        try {
          const claimedTask = this.store.getTask(task.id) ?? { ...task, status: "launching" };
          await this.executor.launch(claimedTask);
        } catch (err) {
          this.store.updateTask(task.id, { status: "failed" });
          this.logger.error(task.id, `Failed to launch: ${String(err)}`);
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
