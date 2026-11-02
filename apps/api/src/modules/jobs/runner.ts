import type { JobConfig } from './config.js';
import type { JobService } from './service.js';

export function createJobRunner(
  jobs: JobService,
  config: JobConfig,
  onError: () => void = () => {},
) {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cycle: Promise<void> | undefined;
  let controller = new AbortController();
  let reported = false;
  async function tick() {
    try {
      const results = await Promise.allSettled(
        Array.from({ length: config.AI_CONCURRENCY }, () => jobs.runOnce(controller.signal)),
      );
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('Worker operation failed.');
      reported = false;
    } catch {
      if (!reported) {
        onError();
        reported = true;
      }
    } finally {
      if (running)
        timer = setTimeout(
          () => {
            cycle = tick();
          },
          reported ? Math.max(5000, config.AI_JOB_POLL_MS) : config.AI_JOB_POLL_MS,
        );
    }
  }
  return {
    start() {
      if (running || !config.AI_WORKER_ENABLED) return;
      running = true;
      controller = new AbortController();
      cycle = tick();
    },
    async stop() {
      running = false;
      clearTimeout(timer);
      controller.abort();
      await cycle;
    },
  };
}
