export { Room } from "./durable-objects/room";
export { AppCoordinator } from "./durable-objects/app";
export { Matcher } from "./durable-objects/matcher";
export { UserHub, Discovery, RateLimiter } from "./durable-objects/hubs";
import { app } from "./http/app";
import { coordinator, roomStub } from "./shared/data";
import type { Env, Job } from "./env";
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<Job>, env: Env) {
    for (const message of batch.messages) {
      try {
        const job = message.body;
        if (job.source === "room")
          await roomStub(env, job.id).deliver(job.operationId);
        else await coordinator(env).deliver(job.operationId);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(coordinator(env).cleanup());
  },
} satisfies ExportedHandler<Env, Job>;
