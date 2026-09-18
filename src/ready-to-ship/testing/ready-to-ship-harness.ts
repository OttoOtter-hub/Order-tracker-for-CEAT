import { makeFakeDataSource } from "../../common/testing/fake-data-source";
import { makeFakeRepo } from "../../common/testing/fake-repo";
import { Role } from "../../common/enums/role.enum";
import type { RequestUser } from "../../common/auth/request-user.interface";
import { PiLineItem } from "../../pi-line-items/pi-line-item.entity";
import { AllocationAction } from "../allocation-action.entity";
import { AllocationRelinkService } from "../allocation-relink.service";
import { ContainerLineAllocation } from "../container-line-allocation.entity";
import { MarkingFile } from "../marking-file.entity";
import { MarkingFilesService } from "../marking-files.service";
import { ReadyToShipService } from "../ready-to-ship.service";
import { ShippingContainer } from "../shipping-container.entity";

export const opsActor: RequestUser = {
  id: "ops-1",
  email: "ops@ceat.com",
  role: Role.OPS,
  customerId: null,
};
export const clientActor: RequestUser = {
  id: "client-1",
  email: "buyer@mtkrosberg.com",
  role: Role.CLIENT,
  customerId: "cust-1",
};
export const otherClientActor: RequestUser = {
  id: "client-2",
  email: "buyer@other.com",
  role: Role.CLIENT,
  customerId: "cust-2",
};

/** Only Date is faked: createdAt ordering needs controllable time, promises must keep working. */
export function useControlledClock(): {
  tick: () => void;
  restore: () => void;
} {
  jest.useFakeTimers({
    now: new Date("2026-09-21T09:00:00Z"),
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  return {
    tick: () => jest.setSystemTime(new Date(Date.now() + 1000)),
    restore: () => jest.useRealTimers(),
  };
}

export function makeHarness() {
  const containers = makeFakeRepo();
  const lines = makeFakeRepo();
  const allocations = makeFakeRepo({
    container: () => containers,
    piLineItem: () => lines,
  });
  const actions = makeFakeRepo({
    container: () => containers,
    piLineItem: () => lines,
  });
  const markings = makeFakeRepo({ allocation: () => allocations });
  const dataSource = makeFakeDataSource(
    new Map<unknown, unknown>([
      [ShippingContainer, containers],
      [ContainerLineAllocation, allocations],
      [AllocationAction, actions],
      [MarkingFile, markings],
      [PiLineItem, lines],
    ]),
  );

  let storedFileCounter = 0;
  const filesService = {
    save: jest.fn(async () => ({ id: `stored-${++storedFileCounter}` })),
    openStoredFile: jest.fn(async (id: string) => ({
      file: { id, mimeType: "application/pdf", originalName: "marking.pdf" },
      stream: `stream-of-${id}`,
    })),
  };

  return {
    containers,
    allocations,
    actions,
    markings,
    lines,
    dataSource,
    filesService,
    service: new ReadyToShipService(dataSource as any),
    markingService: new MarkingFilesService(
      dataSource as any,
      filesService as any,
    ),
    relink: new AllocationRelinkService(dataSource as any),
  };
}

export type Harness = ReturnType<typeof makeHarness>;

/**
 * A line item on an active PI card. loadability = units per container, so
 * dispatchQty / loadability is its container-equivalent. The stored
 * currentWeekDispatchLoadFactor is deliberately garbage: nothing here may
 * trust it.
 */
export function seedLine(
  harness: Harness,
  overrides: {
    id: string;
    piNumber?: string;
    materialNum?: string;
    soNumber?: string;
    loadability?: string | null;
    dispatchQty?: string | null;
    customerId?: string;
    archived?: boolean;
  },
) {
  const line = {
    id: overrides.id,
    pi: {
      id: `pi-of-${overrides.id}`,
      piNumber: overrides.piNumber ?? "100000001",
      isArchivedShipped: overrides.archived ?? false,
      customer: { id: overrides.customerId ?? "cust-1" },
    },
    soNumber: overrides.soNumber ?? "300029159",
    materialNum: overrides.materialNum ?? `MAT-${overrides.id}`,
    materialDesc: `desc ${overrides.id}`,
    loadability:
      overrides.loadability === undefined ? "100" : overrides.loadability,
    currentWeekDispatchQty:
      overrides.dispatchQty === undefined ? "100" : overrides.dispatchQty,
    currentWeekDispatchLoadFactor: "99.9999",
  };
  harness.lines.seed(line as any);
  return line;
}
