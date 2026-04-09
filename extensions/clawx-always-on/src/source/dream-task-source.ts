import type { AlwaysOnTask, TaskSource, TaskSourceInput } from "../core/types.js";
import { createTaskFromSourceInput } from "./user-command-source.js";

export class DreamTaskSource implements TaskSource {
  readonly type = "dream";

  createTask(input: TaskSourceInput): AlwaysOnTask {
    return createTaskFromSourceInput(this.type, input);
  }
}
