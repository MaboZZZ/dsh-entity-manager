/**
 * Async job runner: long operations (npm installs) run off the request path,
 * and the API reports their status by id.
 */
import { randomUUID } from 'node:crypto'

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface Job<T = unknown> {
  id: string
  kind: string
  status: JobStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  /** short human label, e.g. "install @deepseek-ai/dsh@0.1.0-rc.6" */
  label: string
  result: T | null
  error: string | null
  /** target ref for install jobs, e.g. "0.1.0-rc.6" */
  target?: string
}

export class JobRunner {
  private readonly jobs = new Map<string, Job>()
  private readonly queue: Array<{ job: Job; fn: () => Promise<unknown> }> = []
  private running = 0

  constructor(private readonly concurrency = 1) {}

  /** Queue a job; returns immediately with the job id. */
  submit<T>(kind: string, label: string, fn: () => Promise<T>, target?: string): Job<T> {
    const job: Job<T> = {
      id: randomUUID(),
      kind,
      status: 'pending',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      label,
      result: null,
      error: null,
      ...(target !== undefined ? { target } : {}),
    }
    this.jobs.set(job.id, job as Job)
    this.queue.push({ job: job as Job, fn })
    void this.drain()
    return job
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id)
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  private async drain(): Promise<void> {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()
      if (!next) break
      this.running += 1
      const { job, fn } = next
      job.status = 'running'
      job.startedAt = new Date().toISOString()
      try {
        job.result = (await fn()) as unknown
        job.status = 'done'
      } catch (error) {
        job.status = 'failed'
        job.error = error instanceof Error ? error.message : String(error)
      } finally {
        job.finishedAt = new Date().toISOString()
        this.running -= 1
      }
    }
  }
}
