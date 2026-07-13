// Audit job queue abstraction. The in-process implementation runs the worker locally and
// supports cancellation; a managed queue with a bounded worker pool (phase 19 and hosted)
// uses the same interface. The worker receives an isCancelled probe so long audits can stop
// promptly.
export type AuditWorker = (auditId: string, isCancelled: () => boolean) => Promise<void>;

export interface AuditJobQueue {
  enqueue(auditId: string): Promise<void>;
  cancel(auditId: string): Promise<void>;
}

// Development queue: runs the worker in-process. enqueue awaits the worker so tests can
// observe completion; the hosted queue makes this non-blocking and persistent.
export class InProcessQueue implements AuditJobQueue {
  private cancelled = new Set<string>();
  private worker: AuditWorker;

  constructor(worker: AuditWorker) {
    this.worker = worker;
  }

  async enqueue(auditId: string): Promise<void> {
    if (this.cancelled.has(auditId)) return;
    await this.worker(auditId, () => this.cancelled.has(auditId));
  }

  async cancel(auditId: string): Promise<void> {
    this.cancelled.add(auditId);
  }
}
