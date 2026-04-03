import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  highWaterMark: number;
  tasks: Task[];
}

export class TaskStore {
  private dir: string;
  private filePath: string;
  private lockPath: string;
  private maxTasks: number;

  constructor(stateDir?: string, maxTasks = 200) {
    this.dir = stateDir ?? path.join(os.homedir(), ".openclaw", "ct-task-manager");
    this.filePath = path.join(this.dir, "tasks.json");
    this.lockPath = path.join(this.dir, "tasks.lock");
    this.maxTasks = maxTasks;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private read(): StoreData {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as StoreData;
    } catch {
      return { highWaterMark: 0, tasks: [] };
    }
  }

  private write(data: StoreData): void {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  private withLock<T>(fn: () => T): T {
    const maxWait = 5_000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      try {
        fs.mkdirSync(this.lockPath);
        break;
      } catch {
        // Lock held by another process, wait
        const waitMs = 50 + Math.random() * 50;
        const end = Date.now() + waitMs;
        while (Date.now() < end) {
          /* spin */
        }
      }
    }

    try {
      return fn();
    } finally {
      try {
        fs.rmdirSync(this.lockPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  create(params: {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: number;
    blockedBy?: string[];
  }): Task {
    return this.withLock(() => {
      const data = this.read();

      if (data.tasks.length >= this.maxTasks) {
        throw new Error(
          `Task limit reached (${this.maxTasks}). Delete or complete existing tasks first.`,
        );
      }

      data.highWaterMark += 1;
      const now = new Date().toISOString();
      const task: Task = {
        id: `task-${data.highWaterMark}`,
        title: params.title,
        description: params.description ?? "",
        status: params.status ?? "pending",
        priority: params.priority ?? 0,
        blockedBy: params.blockedBy ?? [],
        createdAt: now,
        updatedAt: now,
      };

      data.tasks.push(task);
      this.write(data);
      return task;
    });
  }

  update(
    id: string,
    updates: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "blockedBy">>,
  ): Task {
    return this.withLock(() => {
      const data = this.read();
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`Task not found: ${id}`);

      if (updates.title !== undefined) task.title = updates.title;
      if (updates.description !== undefined) task.description = updates.description;
      if (updates.status !== undefined) task.status = updates.status;
      if (updates.priority !== undefined) task.priority = updates.priority;
      if (updates.blockedBy !== undefined) task.blockedBy = updates.blockedBy;
      task.updatedAt = new Date().toISOString();

      this.write(data);
      return task;
    });
  }

  get(id: string): Task | undefined {
    const data = this.read();
    return data.tasks.find((t) => t.id === id);
  }

  list(filter?: { status?: TaskStatus; includeCompleted?: boolean }): Task[] {
    const data = this.read();
    let tasks = data.tasks;

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    } else if (!filter?.includeCompleted) {
      tasks = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
    }

    return tasks.sort((a, b) => b.priority - a.priority);
  }

  getBlockedStatus(id: string): { blocked: boolean; blockers: string[] } {
    const data = this.read();
    const task = data.tasks.find((t) => t.id === id);
    if (!task) return { blocked: false, blockers: [] };

    const activeBlockers = task.blockedBy.filter((bid) => {
      const blocker = data.tasks.find((t) => t.id === bid);
      return blocker && blocker.status !== "completed" && blocker.status !== "cancelled";
    });

    return { blocked: activeBlockers.length > 0, blockers: activeBlockers };
  }
}
