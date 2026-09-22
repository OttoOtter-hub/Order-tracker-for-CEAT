import { makeFakeRepo } from "../common/testing/fake-repo";
import { NotificationEvent } from "../notifications/notification-events";
import { ActualContainer } from "./actual-container.entity";
import { ArrivalNotificationsService } from "./arrival-notifications.service";

/** Today's own UTC calendar date, offset by whole days — same convention as
 * actual-container.entity.spec.ts. */
function isoDate(daysFromToday: number): string {
  return new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function makeContainer(
  overrides: Partial<ActualContainer> & { id: string },
): ActualContainer {
  return Object.assign(new ActualContainer(), {
    containerNumber: "AAAA1111111",
    customer: { id: "cust-1" },
    sourceEta: null,
    overrideEta: null,
    arrivalConfirmedAt: null,
    arrivalConfirmedByUser: null,
    arrivalNotificationSentAt: null,
    ...overrides,
  });
}

function setup() {
  const repo = makeFakeRepo();
  const eventEmitter = { emit: jest.fn() };
  const config = {
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
  };
  const schedulerRegistry = { addCronJob: jest.fn() };
  const service = new ArrivalNotificationsService(
    repo as any,
    eventEmitter as any,
    config as any,
    schedulerRegistry as any,
  );
  return { service, repo, eventEmitter, schedulerRegistry, config };
}

describe("ArrivalNotificationsService.checkArrivals", () => {
  it("emits container.arrival-expected and stamps the container, on first seeing 'expected'", async () => {
    const { service, repo, eventEmitter } = setup();
    repo.seed(
      makeContainer({
        id: "ct-1",
        sourceEta: isoDate(5),
        containerNumber: "MSKU1234567",
      }),
    );

    await service.checkArrivals();

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      NotificationEvent.CONTAINER_ARRIVAL_EXPECTED,
      {
        containerNumber: "MSKU1234567",
        customerId: "cust-1",
        eta: isoDate(5),
        daysUntilEta: 5,
      },
    );
    expect(repo.rows[0].arrivalNotificationSentAt).toBeInstanceOf(Date);
  });

  it("does not send twice for the same transition on a second run", async () => {
    const { service, repo, eventEmitter } = setup();
    repo.seed(makeContainer({ id: "ct-1", sourceEta: isoDate(5) }));

    await service.checkArrivals();
    await service.checkArrivals();

    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it("does not send while the container is more than 10 days out (not yet 'expected')", async () => {
    const { service, repo, eventEmitter } = setup();
    repo.seed(makeContainer({ id: "ct-1", sourceEta: isoDate(20) }));

    await service.checkArrivals();

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(repo.rows[0].arrivalNotificationSentAt).toBeNull();
  });

  it("does not send for a container with no ETA at all", async () => {
    const { service, repo, eventEmitter } = setup();
    repo.seed(makeContainer({ id: "ct-1", sourceEta: null }));

    await service.checkArrivals();

    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it("does not re-send for a container that already moved on to 'arrived' without ever being caught as 'expected'", async () => {
    // e.g. the cron was down through the whole "expected" window and the
    // next run finds it already 7+ days past ETA — arrivalStatus is
    // "arrived", not "expected", so the (accepted) simplification is that
    // it never gets an "expected" email at all.
    const { service, repo, eventEmitter } = setup();
    repo.seed(makeContainer({ id: "ct-1", sourceEta: isoDate(-10) }));

    await service.checkArrivals();

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(repo.rows[0].arrivalNotificationSentAt).toBeNull();
  });

  it("handles several containers independently in one run", async () => {
    const { service, repo, eventEmitter } = setup();
    repo.seed(
      makeContainer({
        id: "ct-1",
        sourceEta: isoDate(5),
        containerNumber: "AAAA1111111",
      }),
    );
    repo.seed(
      makeContainer({
        id: "ct-2",
        sourceEta: isoDate(20),
        containerNumber: "BBBB2222222",
      }),
    );
    repo.seed(
      makeContainer({
        id: "ct-3",
        sourceEta: isoDate(0),
        containerNumber: "CCCC3333333",
      }),
    );

    await service.checkArrivals();

    expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
    const notified = repo.rows.filter((r: any) => r.arrivalNotificationSentAt);
    expect(notified.map((r: any) => r.id).sort()).toEqual(["ct-1", "ct-3"]);
  });
});

describe("ArrivalNotificationsService.onModuleInit", () => {
  it("registers a cron job using NOTIFICATION_CHECK_CRON, defaulting to 08:00", () => {
    const { service, schedulerRegistry, config } = setup();

    service.onModuleInit();

    expect(config.get).toHaveBeenCalledWith(
      "NOTIFICATION_CHECK_CRON",
      "0 8 * * *",
    );
    expect(schedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);
    const [name, job] = schedulerRegistry.addCronJob.mock.calls[0];
    expect(name).toBe("arrival-notifications-check");
    expect(job).toBeDefined();

    // onModuleInit starts the job for real (a live setTimeout to the next
    // 08:00) — stop it so it doesn't keep the test process alive.
    job.stop();
  });
});
