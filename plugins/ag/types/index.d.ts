/**
 * `done`: built and on main, not released yet. `deployed`: its release is live.
 * `shown`: built and shown, waiting for the person's sign-off. All three count as done.
 * `needs-you`: waiting for the person (their setup, a key, a decision); it does not count as done.
 */
export type TaskStatus = 'todo' | 'doing' | 'done' | 'deployed' | 'shown' | 'needs-you' | 'waiting' | 'blocked' | 'skipped'

/**
 * A story (a step of an epic), or a subtask of a story in `steps`.
 * `tokens`: the tokens it used, a whole number; with none of its own, the sum of its subtasks'.
 * `engine`: the model running it ("sonnet", "fw:glm-5p3-flash").
 * `statusText`: the status as written, when it was not one of the canonical words ("running").
 */
export type GoalStep = {
  id: string
  title: string
  status: TaskStatus
  note?: string
  tokens?: number
  engine?: string
  statusText?: string
  steps?: GoalStep[]
}

/** An epic (a phase): its stories in `steps`. `tokens`: its own count, else the sum of its stories'. */
export type GoalTask = {
  id: string
  title: string
  status: TaskStatus
  note?: string
  tokens?: number
  engine?: string
  statusText?: string
  steps: GoalStep[]
}

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
    'ag': {
      progress: GoalProgress | null
      isHidden: boolean
      tick: number
      /** Tasks the person opened (true) or closed (false) in the pane; absent, only the current task is open. */
      opened: Record<string, boolean>
    }
  }
}
