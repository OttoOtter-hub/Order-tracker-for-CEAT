import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SchedulerRegistry } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { CronJob } from "cron";
import { Repository } from "typeorm";
import { NotificationEvent } from "../notifications/notification-events";
import { ActualContainer } from "./actual-container.entity";
import { daysBetween } from "./utils/days-between";

const DEFAULT_CRON = "0 8 * * *";
const JOB_NAME = "arrival-notifications-check";

/**
 * Event 4 (Phase 13): the only trigger with no explicit action behind it —
 * arrivalStatus is computed from today's date, not set by anyone clicking
 * anything, so a daily check is what stands in for the "transactional
 * method" the other three events emit at the end of. Registered dynamically
 * via SchedulerRegistry rather than a static @Cron() decorator: the decorator
 * evaluates at class-definition time (when this file is first required,
 * while app.module.ts's imports are still being resolved), before
 * ConfigModule has loaded .env — reading NOTIFICATION_CHECK_CRON that early
 * would silently see undefined every time.
 */
@Injectable()
export class ArrivalNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(ArrivalNotificationsService.name);

  constructor(
    @InjectRepository(ActualContainer)
    private readonly repo: Repository<ActualContainer>,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const expression = this.config.get<string>(
      "NOTIFICATION_CHECK_CRON",
      DEFAULT_CRON,
    );
    const job = new CronJob(expression, () => {
      this.checkArrivals().catch((err) =>
        this.logger.error(`arrival check failed: ${(err as Error).message}`),
      );
    });
    this.schedulerRegistry.addCronJob(JOB_NAME, job);
    job.start();
  }

  /**
   * Sends exactly once per container, the first run where arrivalStatus is
   * "expected" — arrival_notification_sent_at is set right then and never
   * cleared, so a later run (still "expected", or moved on to "arrived")
   * never re-sends. A container whose ETA moves back out after being
   * notified once stays silent if it re-enters "expected" later — accepted
   * simplification, see README "Фаза 13".
   */
  async checkArrivals(): Promise<void> {
    // Pilot scale (dozens to low hundreds of containers) — fetch once and
    // filter in JS rather than pushing an IS NULL into the query, keeping
    // this on the same plain find()-then-filter shape as the rest of this
    // service (see ActualContainersService).
    const containers = await this.repo.find({ relations: ["customer"] });
    const todayIso = new Date().toISOString().slice(0, 10);
    for (const container of containers) {
      if (
        container.arrivalNotificationSentAt ||
        container.arrivalStatus !== "expected" ||
        !container.eta
      ) {
        continue;
      }
      container.arrivalNotificationSentAt = new Date();
      await this.repo.save(container);
      this.eventEmitter.emit(NotificationEvent.CONTAINER_ARRIVAL_EXPECTED, {
        containerNumber: container.containerNumber,
        customerId: container.customer.id,
        eta: container.eta,
        daysUntilEta: daysBetween(todayIso, container.eta),
      });
    }
  }
}
