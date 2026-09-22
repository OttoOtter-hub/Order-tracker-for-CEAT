import { instanceToPlain } from "class-transformer";
import { ActualContainer } from "./actual-container.entity";

function makeContainer(
  overrides: Partial<ActualContainer> = {},
): ActualContainer {
  return Object.assign(new ActualContainer(), {
    sourceEta: null,
    overrideEta: null,
    arrivalConfirmedAt: null,
    arrivalConfirmedByUser: null,
    ...overrides,
  });
}

/** Today's own UTC calendar date, offset by whole days — exact regardless of
 * the time of day the test happens to run at (adding N*86_400_000ms to "now"
 * shifts the calendar date by exactly N days in UTC, DST-free). */
function isoDate(daysFromToday: number): string {
  return new Date(Date.now() + daysFromToday * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

describe("ActualContainer.arrivalStatus", () => {
  it("is null when there is no ETA at all", () => {
    expect(makeContainer().arrivalStatus).toBeNull();
  });

  it("is null more than 10 days before the ETA, expected exactly at 10 days", () => {
    expect(makeContainer({ sourceEta: isoDate(11) }).arrivalStatus).toBeNull();
    expect(makeContainer({ sourceEta: isoDate(10) }).arrivalStatus).toBe(
      "expected",
    );
  });

  it("is expected anywhere from 10 days out through the ETA day itself", () => {
    expect(makeContainer({ sourceEta: isoDate(5) }).arrivalStatus).toBe(
      "expected",
    );
    expect(makeContainer({ sourceEta: isoDate(0) }).arrivalStatus).toBe(
      "expected",
    );
  });

  it("stays expected through 6 days after the ETA, flips to arrived at 7", () => {
    expect(makeContainer({ sourceEta: isoDate(-6) }).arrivalStatus).toBe(
      "expected",
    );
    expect(makeContainer({ sourceEta: isoDate(-7) }).arrivalStatus).toBe(
      "arrived",
    );
    expect(makeContainer({ sourceEta: isoDate(-8) }).arrivalStatus).toBe(
      "arrived",
    );
  });

  it("a manual confirmation means arrived regardless of how far away the ETA is", () => {
    const notYetDue = makeContainer({
      sourceEta: isoDate(30),
      arrivalConfirmedAt: new Date(),
    });
    expect(notYetDue.arrivalStatus).toBe("arrived");

    const noEtaAtAll = makeContainer({ arrivalConfirmedAt: new Date() });
    expect(noEtaAtAll.arrivalStatus).toBe("arrived");
  });

  it("the override ETA is the effective one, not the file's", () => {
    const container = makeContainer({
      sourceEta: isoDate(20), // would be null (too far out) on its own
      overrideEta: isoDate(5), // but the override is 5 days out -> expected
    });
    expect(container.arrivalStatus).toBe("expected");
  });

  it("is exposed in serialization, arrivalConfirmedBy is the confirmer's email or null", () => {
    const unconfirmed = instanceToPlain(
      makeContainer({ sourceEta: isoDate(3) }),
    );
    expect(unconfirmed.arrivalStatus).toBe("expected");
    expect(unconfirmed.arrivalConfirmedBy).toBeNull();
    expect(unconfirmed.arrivalConfirmedByUser).toBeUndefined();

    const confirmed = instanceToPlain(
      makeContainer({
        arrivalConfirmedAt: new Date(),
        arrivalConfirmedByUser: { email: "client@x.com" } as any,
      }),
    );
    expect(confirmed.arrivalStatus).toBe("arrived");
    expect(confirmed.arrivalConfirmedBy).toBe("client@x.com");
    expect(confirmed.arrivalConfirmedByUser).toBeUndefined();
  });
});
