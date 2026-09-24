import { ExecutionContext, ForbiddenException, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { RolesGuard } from "../common/auth/roles.guard";
import { Role } from "../common/enums/role.enum";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { AUDIT_ACTIONS } from "./audit-actions";
import { AuditLog } from "./audit-log.entity";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";

describe("AuditLogService", () => {
  let users: ReturnType<typeof makeFakeRepo>;
  let repo: ReturnType<typeof makeFakeRepo>;
  let service: AuditLogService;

  beforeEach(() => {
    users = makeFakeRepo();
    users.seed({ id: "ops-1", email: "ops@ceat.com" });
    users.seed({ id: "client-1", email: "buyer@mtk.com" });
    repo = makeFakeRepo({ actor: () => users });
    service = new AuditLogService(repo as any);
  });

  describe("record", () => {
    it("writes through the caller's transaction when given one", async () => {
      const txRepo = makeFakeRepo();
      const em = {
        getRepository: jest.fn((entity) => {
          expect(entity).toBe(AuditLog);
          return txRepo;
        }),
      };

      await service.record(
        {
          actor: { id: "ops-1" },
          action: "rts.confirmed",
          entityType: "customer",
          entityId: "cust-1",
          metadata: { positionsLocked: 3 },
        },
        em as any,
      );

      expect(txRepo.rows).toEqual([
        expect.objectContaining({
          actor: { id: "ops-1" },
          action: "rts.confirmed",
          entityType: "customer",
          entityId: "cust-1",
          metadata: { positionsLocked: 3 },
        }),
      ]);
      expect(repo.rows).toHaveLength(0);
    });

    it("in a transaction, a failure to journal fails the action (throws)", async () => {
      const em = {
        getRepository: () => ({
          create: (x: unknown) => x,
          save: async () => {
            throw new Error("db down");
          },
        }),
      };
      await expect(
        service.record(
          {
            actor: { id: "ops-1" },
            action: "rts.moved",
            entityType: "shipping_container",
            entityId: "c-1",
          },
          em as any,
        ),
      ).rejects.toThrow("db down");
    });

    it("without one, a failure is logged, not thrown (the action already happened)", async () => {
      repo.save.mockRejectedValueOnce(new Error("db down"));
      const log = jest.spyOn(Logger.prototype, "error").mockImplementation();

      await expect(
        service.record({
          actor: { id: "ops-1" },
          action: "user.created",
          entityType: "user",
          entityId: "u-9",
        }),
      ).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("user.created"));
      log.mockRestore();
    });

    it("stores {} when there is no metadata", async () => {
      await service.record({
        actor: { id: "ops-1" },
        action: "container.arrival_revoked",
        entityType: "actual_container",
        entityId: "ct-1",
      });
      expect(repo.rows[0].metadata).toEqual({});
    });
  });

  describe("find", () => {
    const at = (iso: string) => new Date(iso);

    beforeEach(() => {
      const seed = (
        id: string,
        actor: string,
        action: string,
        entityType: string,
        entityId: string,
        createdAt: string,
      ) =>
        repo.seed({
          id,
          actor: { id: actor },
          action,
          entityType,
          entityId,
          metadata: {},
          createdAt: at(createdAt),
        });
      seed(
        "a1",
        "ops-1",
        "pi.file_uploaded",
        "pi",
        "pi-1",
        "2026-09-01T10:00:00Z",
      );
      seed("a2", "client-1", "pi.signed", "pi", "pi-1", "2026-09-02T10:00:00Z");
      seed(
        "a3",
        "client-1",
        "rts.moved",
        "shipping_container",
        "c-1",
        "2026-09-03T10:00:00Z",
      );
      seed(
        "a4",
        "ops-1",
        "user.created",
        "user",
        "u-1",
        "2026-09-04T10:00:00Z",
      );
      seed(
        "a5",
        "client-1",
        "pi.label_changed",
        "pi",
        "pi-2",
        "2026-09-05T10:00:00Z",
      );
    });

    const ids = (page: { items: { id: string }[] }) =>
      page.items.map((i) => i.id);

    it("returns newest first with the actor's email, and the total", async () => {
      const page = await service.find({ page: 1, pageSize: 50 });

      expect(ids(page)).toEqual(["a5", "a4", "a3", "a2", "a1"]);
      expect(page.total).toBe(5);
      expect(page.items[0].actor).toEqual({
        id: "client-1",
        email: "buyer@mtk.com",
      });
    });

    it("pages without loading everything: page 2 of size 2, total unchanged", async () => {
      const page = await service.find({ page: 2, pageSize: 2 });

      expect(ids(page)).toEqual(["a3", "a2"]);
      expect(page).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    });

    it("filters by entity type + id, actor, action", async () => {
      expect(
        ids(
          await service.find({
            entityType: "pi",
            entityId: "pi-1",
            page: 1,
            pageSize: 50,
          }),
        ),
      ).toEqual(["a2", "a1"]);
      expect(
        ids(
          await service.find({ actorUserId: "ops-1", page: 1, pageSize: 50 }),
        ),
      ).toEqual(["a4", "a1"]);
      expect(
        ids(await service.find({ action: "rts.moved", page: 1, pageSize: 50 })),
      ).toEqual(["a3"]);
    });

    it("filters by a date range: from inclusive, to exclusive, or either alone", async () => {
      expect(
        ids(
          await service.find({
            from: at("2026-09-02T10:00:00Z"),
            to: at("2026-09-04T10:00:00Z"),
            page: 1,
            pageSize: 50,
          }),
        ),
      ).toEqual(["a3", "a2"]);
      expect(
        ids(
          await service.find({
            from: at("2026-09-04T00:00:00Z"),
            page: 1,
            pageSize: 50,
          }),
        ),
      ).toEqual(["a5", "a4"]);
      expect(
        ids(
          await service.find({
            to: at("2026-09-02T00:00:00Z"),
            page: 1,
            pageSize: 50,
          }),
        ),
      ).toEqual(["a1"]);
    });
  });
});

describe("GET /audit-log access", () => {
  const guard = new RolesGuard(new Reflector());
  const context = (role: Role) =>
    ({
      getHandler: () => AuditLogController.prototype.find,
      getClass: () => AuditLogController,
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
          user: { id: "u", email: "u@x.com", role, customerId: "cust-1" },
        }),
      }),
    }) as unknown as ExecutionContext;

  it("is ops-only: a client gets 403 OPS_ONLY_ACTION even on GET", () => {
    expect(() => guard.canActivate(context(Role.CLIENT))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(context(Role.OPS))).toBe(true);
  });
});

// Every action in the registry is actually written somewhere in app code —
// a registry entry nothing records would be a journal filter that never matches.
describe("audit action registry", () => {
  const SRC = join(__dirname, "..");
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
    });
  }

  it("each action is recorded by some service", () => {
    const code = sourceFiles(SRC)
      .filter((f) => !f.includes("audit-actions"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const unused = AUDIT_ACTIONS.filter(
      (action) => !code.includes(`"${action}"`),
    );
    expect(unused).toEqual([]);
  });

  // i18next reads "." as nesting, so "pi.file_uploaded" lives at
  // audit.actions.pi.file_uploaded — one level per segment.
  it("the frontend has an en and ru text for every action", () => {
    const locales = join(__dirname, "../../frontend/src/i18n/locales");
    const flatten = (node: unknown, prefix = ""): string[] =>
      node && typeof node === "object"
        ? Object.entries(node).flatMap(([key, value]) =>
            flatten(value, prefix ? `${prefix}.${key}` : key),
          )
        : typeof node === "string" && node !== ""
          ? [prefix]
          : [];
    for (const language of ["en", "ru"]) {
      const dictionary = JSON.parse(
        readFileSync(join(locales, `${language}.json`), "utf8"),
      ) as { audit?: { actions?: unknown } };
      const texts = flatten(dictionary.audit?.actions ?? {});
      const missing = AUDIT_ACTIONS.filter((a) => !texts.includes(a));
      const extra = texts.filter(
        (a) => !(AUDIT_ACTIONS as readonly string[]).includes(a),
      );
      expect({ language, missing, extra }).toEqual({
        language,
        missing: [],
        extra: [],
      });
    }
  });
});
