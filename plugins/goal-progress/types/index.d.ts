/**
 * `done`: built and on main, not released yet. `deployed`: its release is live.
 * `shown`: built and shown, waiting for the person's sign-off. All three count as done.
 */
export type TaskStatus = 'todo' | 'doing' | 'done' | 'deployed' | 'shown' | 'waiting' | 'blocked' | 'skipped'

/** `tokens`: the tokens the step used, a whole number. `engine`: the model running it ("sonnet", "fw:glm-5p3-flash"). */
export type GoalStep = { id: string; title: string; status: TaskStatus; note?: string; tokens?: number; engine?: string }

/** `tokens`: the task's own count, else the sum of its steps' counts when any step has one. */
export type GoalTask = { id: string; title: string; status: TaskStatus; note?: string; tokens?: number; steps: GoalStep[] }

/**
 * Work going on right now, outside the steps: a deploy, a test suite, the builders.
 * `kind` is free text; `deploy`, `tests`, `build` and `review` get their own color.
 * `since` (ISO time) shows how long it has been running.
 */
export type RunningJob = { kind: string; title: string; since?: string; note?: string; engine?: string }

/** One update the goal also gave in chat ("Release 0.9.6 is deploying"); `at` is an ISO time. */
export type LogLine = { text: string; at?: string }

/** The shape of .claude/goal-progress.json, as the goal writes it. */
export type GoalProgress = {
  goal: string
  plan?: string
  status: 'running' | 'waiting' | 'blocked' | 'done'
  note?: string
  updated?: string
  tasks: GoalTask[]
  /** What is running now; empty when nothing is. */
  running: RunningJob[]
  /** The goal's updates, oldest first; the pane shows the last few, newest first. */
  log: LogLine[]
}

declare module 'claude-code' {
  interface PluginState {
    'goal-progress': {
      progress: GoalProgress | null
      isHidden: boolean
      tick: number
      /** Tasks the person opened (true) or closed (false) in the pane; absent, only the current task is open. */
      opened: Record<string, boolean>
    }
  }
}
