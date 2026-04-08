import type { TaskSource } from "../core/types.js";

export class TaskSourceRegistry {
  private readonly sources = new Map<string, TaskSource>();

  register(source: TaskSource): void {
    this.sources.set(source.type, source);
  }

  get(type: string): TaskSource | undefined {
    return this.sources.get(type);
  }

  getAll(): TaskSource[] {
    return [...this.sources.values()];
  }
}
