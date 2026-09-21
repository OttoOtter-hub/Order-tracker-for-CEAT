import * as ExcelJS from "exceljs";
import { NotFoundException } from "@nestjs/common";
import { ActualContainer } from "../actual-containers/actual-container.entity";
import { ActualContainerLineItem } from "../actual-containers/actual-container-line-item.entity";
import { ActualContainersImportService } from "../actual-containers/actual-containers-import.service";
import { ActualContainersService } from "../actual-containers/actual-containers.service";
import { Role } from "../common/enums/role.enum";
import type { RequestUser } from "../common/auth/request-user.interface";
import { makeFakeDataSource } from "../common/testing/fake-data-source";
import { makeFakeRepo } from "../common/testing/fake-repo";
import { PiLineItem } from "../pi-line-items/pi-line-item.entity";
import { ProformaInvoice } from "../proforma-invoices/proforma-invoice.entity";
import { BackorderUpload } from "./backorder-upload.entity";
import { BackorderUploadSnapshot } from "./backorder-upload-snapshot.entity";
import { BackorderUploadsService } from "./backorder-uploads.service";
import {
  boRow,
  buildWeeklyFile,
  containerRow,
  dispatchRow,
  eta15Row,
} from "./testing/weekly-workbook";

const ops: RequestUser = {
  id: "ops-1",
  email: "ops@ceat.com",
  role: Role.OPS,
  customerId: null,
};

function setup() {
  const backorderRepo = makeFakeRepo();
  const piRepo = makeFakeRepo();
  const lineItemsRepo = makeFakeRepo();
  const snapshotRepo = makeFakeRepo();
  const containerRepo = makeFakeRepo();
  const containerLineRepo = makeFakeRepo();
  const containerFileRepo = makeFakeRepo();
  const customer = { id: "cust-1", name: "MTK", customerCode: "66000402" };
  const customersService = {
    findFirst: jest.fn(async () => customer),
    findAll: jest.fn(async () => [customer]),
  };
  const relink = jest.fn(async () => undefined);
  const dataSource = makeFakeDataSource(
    new Map<unknown, unknown>([
      [BackorderUpload, backorderRepo],
      [ProformaInvoice, piRepo],
      [PiLineItem, lineItemsRepo],
      [BackorderUploadSnapshot, snapshotRepo],
      [ActualContainer, containerRepo],
      [ActualContainerLineItem, containerLineRepo],
    ]),
  );
  const uploads = new BackorderUploadsService(
    backorderRepo as any,
    piRepo as any,
    customersService as any,
    { save: jest.fn(async () => ({ id: "stored-1" })) } as any,
    { relink } as any,
    dataSource as any,
    new ActualContainersImportService(customersService as any),
  );
  const filesService = {
    save: jest.fn(async (file: { originalname: string }) => ({
      id: `stored-${file.originalname}`,
      originalName: file.originalname,
    })),
    openStoredFile: jest.fn(),
  };
  // The fake repo does not join collections, so relations = [lineItems, files] are stitched on here.
  const containerRepoWithRelations = {
    ...containerRepo,
    findOne: async (options: { where: Record<string, any> }) => {
      const row = await containerRepo.findOne({ where: options.where });
      return row
        ? {
            ...row,
            lineItems: containerLineRepo.rows.filter(
              (l) => l.actualContainer.id === row.id,
            ),
            files: containerFileRepo.rows.filter(
              (f) => f.actualContainer.id === row.id,
            ),
          }
        : null;
    },
  };
  const containers = new ActualContainersService(
    containerRepoWithRelations as any,
    containerFileRepo as any,
    filesService as any,
  );
  return {
    uploads,
    containers,
    repos: {
      backorderRepo,
      piRepo,
      snapshotRepo,
      containerRepo,
      containerLineRepo,
      containerFileRepo,
    },
    dataSource,
    relink,
    customersService,
  };
}

// Rows of the fake repos are untyped bags; any keeps the assertions readable.
const containerByNumber = (
  repo: ReturnType<typeof makeFakeRepo>,
  number: string,
): any => repo.rows.find((r) => r.containerNumber === number)!;

const linesOf = (
  repo: ReturnType<typeof makeFakeRepo>,
  containerId: string,
): any[] => repo.rows.filter((r) => r.actualContainer.id === containerId);

describe("backorder upload — shipped containers", () => {
  it("runs the whole import in one transaction and hands the same manager to the relink", async () => {
    const { uploads, dataSource, relink } = setup();
    const file = await buildWeeklyFile({ bo: [boRow(100037320, "107071")] });
    await uploads.upload(file as any, ops);
    relink.mockClear();
    dataSource.transaction.mockClear();

    await uploads.upload(file as any, ops);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(relink).toHaveBeenCalledTimes(1);
    expect((relink.mock.calls[0] as unknown[])[2]).toBe(dataSource.manager);
  });

  describe("ETD-ETA -> ActualContainer upsert", () => {
    it("creates a container per row with the file's fields, no overrides, and the upload as last seen", async () => {
      const { uploads, repos } = setup();
      const file = await buildWeeklyFile({
        containers: [
          containerRow({
            container: "BEAU6469435",
            vessel: "MV PAPU/ PAP0226W",
            etd: "2026-04-05",
            eta: "2026-05-20",
            preshipment: 340287277,
            commercial: 9357868246,
          }),
          containerRow({ container: "CAAU6845690", vessel: 0 }),
        ],
      });

      const result = await uploads.upload(file as any, ops);

      expect(result.actualContainers).toMatchObject({
        containersCreated: 2,
        containersUpdated: 0,
        containersWithoutTransportData: 0,
      });
      expect(repos.containerRepo.rows).toHaveLength(2);
      const first = containerByNumber(repos.containerRepo, "BEAU6469435");
      expect(first).toMatchObject({
        customer: { id: "cust-1" },
        port: "Novorossiysk",
        vesselName: "MV PAPU/ PAP0226W",
        sourceEtd: "2026-04-05",
        sourceEta: "2026-05-20",
        preshipmentInvoice: "340287277",
        commercialInvoiceNumber: "9357868246",
        overrideEtd: null,
        overrideEta: null,
      });
      expect(first.lastSeenInUpload).toEqual({ id: result.id });
      expect(
        containerByNumber(repos.containerRepo, "CAAU6845690"),
      ).toMatchObject({
        vesselName: null,
        sourceEta: null,
        preshipmentInvoice: null,
      });
    });

    it("overwrites source_* on a repeat upload but never override_etd / override_eta", async () => {
      const { uploads, containers, repos } = setup();
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({
              container: "BEAU6469435",
              etd: "2026-04-05",
              vessel: "OLD VESSEL",
            }),
          ],
        })) as any,
        ops,
      );
      const id = containerByNumber(repos.containerRepo, "BEAU6469435").id;
      await containers.updateDates(
        id,
        { overrideEtd: "2026-04-12", overrideEta: "2026-06-01" },
        ops,
      );

      const second = await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({
              container: "BEAU6469435",
              etd: "2026-04-08",
              eta: "2026-05-25",
              vessel: "NEW VESSEL",
            }),
          ],
        })) as any,
        ops,
      );

      const row = containerByNumber(repos.containerRepo, "BEAU6469435");
      expect(repos.containerRepo.rows).toHaveLength(1);
      expect(row.id).toBe(id);
      expect(second.actualContainers).toMatchObject({
        containersCreated: 0,
        containersUpdated: 1,
      });
      expect(row).toMatchObject({
        vesselName: "NEW VESSEL",
        sourceEtd: "2026-04-08",
        sourceEta: "2026-05-25",
        overrideEtd: "2026-04-12",
        overrideEta: "2026-06-01",
      });
      expect(row.lastSeenInUpload).toEqual({ id: second.id });
    });

    it("leaves a container the new file no longer lists exactly as it was", async () => {
      const { uploads, repos } = setup();
      const first = await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "BEAU6469435", vessel: "V1" }),
            containerRow({ container: "CAAU6845690", vessel: "V2" }),
          ],
          radialDispatch: [
            dispatchRow({ container: "CAAU6845690", pi: 100035541, qty: 7 }),
          ],
        })) as any,
        ops,
      );

      const second = await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "BEAU6469435", vessel: "V1b" }),
          ],
        })) as any,
        ops,
      );

      const untouched = containerByNumber(repos.containerRepo, "CAAU6845690");
      expect(untouched.vesselName).toBe("V2");
      expect(untouched.lastSeenInUpload).toEqual({ id: first.id });
      expect(
        containerByNumber(repos.containerRepo, "BEAU6469435").lastSeenInUpload,
      ).toEqual({
        id: second.id,
      });
      expect(linesOf(repos.containerLineRepo, untouched.id)).toHaveLength(1);
    });
  });

  describe("ETA-15 days -> extra fields", () => {
    it("fills the extra fields of matching containers and skips (and counts) unknown ones", async () => {
      const { uploads, repos } = setup();

      const result = await uploads.upload(
        (await buildWeeklyFile({
          containers: [containerRow({ container: "CRSU9167145" })],
          eta15: [
            eta15Row({
              container: "CRSU9167145",
              bl: "ALIN26000843  ",
              value: 2423377.89,
              telex: "2026-09-01",
            }),
            eta15Row({ container: "ZZZZ0000000" }),
          ],
        })) as any,
        ops,
      );

      expect(result.actualContainers).toMatchObject({
        eta15Updated: 1,
        eta15Unmatched: 1,
      });
      expect(repos.containerRepo.rows).toHaveLength(1);
      expect(
        containerByNumber(repos.containerRepo, "CRSU9167145"),
      ).toMatchObject({
        blNumber: "ALIN26000843",
        currency: "INR",
        invoiceValue: "2423377.89",
        documentsReleaseStatus: "0",
        telexReleaseDate: "2026-09-01",
        paymentReceiptStatus: null,
      });
    });

    it("keeps the extra fields of a container that drops out of a later 15-day sample", async () => {
      const { uploads, repos } = setup();
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "CRSU9167145" }),
            containerRow({ container: "GESU6835948" }),
          ],
          eta15: [
            eta15Row({ container: "CRSU9167145", bl: "BL-A" }),
            eta15Row({ container: "GESU6835948", bl: "BL-B" }),
          ],
        })) as any,
        ops,
      );

      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "CRSU9167145" }),
            containerRow({ container: "GESU6835948" }),
          ],
          eta15: [
            eta15Row({ container: "CRSU9167145", bl: "BL-A2", value: 1 }),
          ],
        })) as any,
        ops,
      );

      expect(
        containerByNumber(repos.containerRepo, "CRSU9167145"),
      ).toMatchObject({
        blNumber: "BL-A2",
        invoiceValue: "1",
      });
      expect(
        containerByNumber(repos.containerRepo, "GESU6835948"),
      ).toMatchObject({
        blNumber: "BL-B",
        invoiceValue: "2423377.89",
      });
    });
  });

  describe("ETD/ETA that ETD-ETA leaves empty", () => {
    it("takes ETA (and ETD) from the container's ETA-15 row when ETD-ETA has none, and the ETD-ETA date wins when it has one", async () => {
      const { uploads, repos } = setup();

      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            // ETD known, ETA empty (the Excel zero date, as in the real file).
            containerRow({ container: "AAAA1111111", etd: "2026-07-01" }),
            // both known: ETD-ETA must win over the ETA-15 row.
            containerRow({
              container: "BBBB2222222",
              etd: "2026-07-02",
              eta: "2026-08-15",
            }),
            // both empty and not in ETA-15 either: stays empty.
            containerRow({ container: "CCCC3333333", etd: null }),
            // ETD-ETA has neither date, ETA-15 has both.
            containerRow({ container: "DDDD4444444", etd: null }),
          ],
          eta15: [
            eta15Row({
              container: "AAAA1111111",
              etd: "2026-07-31",
              eta: "2026-09-20",
            }),
            eta15Row({
              container: "BBBB2222222",
              etd: "2026-07-31",
              eta: "2026-09-20",
            }),
            eta15Row({
              container: "DDDD4444444",
              etd: "2026-07-31",
              eta: "2026-09-21",
            }),
          ],
        })) as any,
        ops,
      );

      const dates = (n: string) => {
        const c = containerByNumber(repos.containerRepo, n);
        return [c.sourceEtd, c.sourceEta];
      };
      expect(dates("AAAA1111111")).toEqual(["2026-07-01", "2026-09-20"]);
      expect(dates("BBBB2222222")).toEqual(["2026-07-02", "2026-08-15"]);
      expect(dates("CCCC3333333")).toEqual([null, null]);
      expect(dates("DDDD4444444")).toEqual(["2026-07-31", "2026-09-21"]);
    });

    it("keeps a date learned earlier when a later file has it nowhere, and never touches a manual date", async () => {
      const { uploads, containers, repos } = setup();
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "AAAA1111111", etd: "2026-07-01" }),
          ],
          eta15: [eta15Row({ container: "AAAA1111111", eta: "2026-09-20" })],
        })) as any,
        ops,
      );
      const id = containerByNumber(repos.containerRepo, "AAAA1111111").id;
      await containers.updateDates(id, { overrideEta: "2026-10-01" }, ops);

      // Next week the container has dropped out of the 15-day sample and
      // ETD-ETA still has no ETA.
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "AAAA1111111", etd: "2026-07-01" }),
          ],
        })) as any,
        ops,
      );

      expect(
        containerByNumber(repos.containerRepo, "AAAA1111111"),
      ).toMatchObject({
        sourceEta: "2026-09-20",
        overrideEta: "2026-10-01",
      });
    });

    it("for a container ETD-ETA does not list this week, fills only dates that are still empty", async () => {
      const { uploads, repos } = setup();
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({
              container: "AAAA1111111",
              etd: "2026-07-01",
              eta: "2026-08-01",
            }),
            containerRow({ container: "BBBB2222222", etd: "2026-07-02" }),
          ],
        })) as any,
        ops,
      );

      await uploads.upload(
        (await buildWeeklyFile({
          eta15: [
            eta15Row({
              container: "AAAA1111111",
              etd: "2026-07-31",
              eta: "2026-09-20",
            }),
            eta15Row({
              container: "BBBB2222222",
              etd: "2026-07-31",
              eta: "2026-09-20",
            }),
          ],
        })) as any,
        ops,
      );

      const a = containerByNumber(repos.containerRepo, "AAAA1111111");
      const b = containerByNumber(repos.containerRepo, "BBBB2222222");
      expect([a.sourceEtd, a.sourceEta]).toEqual(["2026-07-01", "2026-08-01"]);
      expect([b.sourceEtd, b.sourceEta]).toEqual(["2026-07-02", "2026-09-20"]);
    });
  });

  describe("Radial/Bias Dispatch -> line items", () => {
    it("stores every line, including a container whose lines are split between the Radial and Bias sheets", async () => {
      const { uploads, repos } = setup();

      const result = await uploads.upload(
        (await buildWeeklyFile({
          containers: [containerRow({ container: "CAAU6845690" })],
          radialDispatch: [
            dispatchRow({
              container: "CAAU6845690",
              pi: 100035541,
              qty: 2,
              material: 106907,
            }),
          ],
          biasDispatch: [
            dispatchRow({
              container: "CAAU6845690",
              pi: 100035801,
              qty: 20,
              material: 107544,
              category: "Bias",
            }),
          ],
        })) as any,
        ops,
      );

      const container = containerByNumber(repos.containerRepo, "CAAU6845690");
      const lines = linesOf(repos.containerLineRepo, container.id);
      expect(lines.map((l) => [l.piNumber, l.materialNum, l.quantity])).toEqual(
        [
          ["100035541", "106907", "2"],
          ["100035801", "107544", "20"],
        ],
      );
      expect(lines[0]).toMatchObject({
        invoiceNumber: "340287276",
        pgiDate: "2026-03-26",
        customerOrderRef: "Email dated 06.02.2026",
      });
      expect(result.actualContainers).toMatchObject({
        containersReplaced: 1,
        dispatchLinesStored: 2,
      });
    });

    it("replaces a container's lines wholesale on the next upload, only for containers that file lists", async () => {
      const { uploads, repos } = setup();
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "AAAA1111111" }),
            containerRow({ container: "BBBB2222222" }),
          ],
          radialDispatch: [
            dispatchRow({
              container: "AAAA1111111",
              pi: 100000001,
              qty: 5,
              material: 1,
            }),
            dispatchRow({
              container: "AAAA1111111",
              pi: 100000001,
              qty: 6,
              material: 2,
            }),
            dispatchRow({
              container: "BBBB2222222",
              pi: 100000002,
              qty: 9,
              material: 3,
            }),
          ],
        })) as any,
        ops,
      );

      // Week 2: A is corrected (one line, other quantity); B is not in the file at all.
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [containerRow({ container: "AAAA1111111" })],
          radialDispatch: [
            dispatchRow({
              container: "AAAA1111111",
              pi: 100000001,
              qty: 4,
              material: 1,
            }),
          ],
        })) as any,
        ops,
      );

      const a = containerByNumber(repos.containerRepo, "AAAA1111111");
      const b = containerByNumber(repos.containerRepo, "BBBB2222222");
      expect(
        linesOf(repos.containerLineRepo, a.id).map((l) => l.quantity),
      ).toEqual(["4"]);
      expect(
        linesOf(repos.containerLineRepo, b.id).map((l) => l.quantity),
      ).toEqual(["9"]);
    });

    it("keeps two identical lines of one container as two lines", async () => {
      const { uploads, repos } = setup();
      const same = dispatchRow({
        container: "AAAA1111111",
        pi: 100000001,
        qty: 2,
        material: 1,
      });

      await uploads.upload(
        (await buildWeeklyFile({
          containers: [containerRow({ container: "AAAA1111111" })],
          radialDispatch: [same, same],
        })) as any,
        ops,
      );

      expect(repos.containerLineRepo.rows).toHaveLength(2);
    });

    it("keeps a container that is in Dispatch but in no ETD-ETA row, with no transport data, and says so", async () => {
      const { uploads, repos } = setup();

      const result = await uploads.upload(
        (await buildWeeklyFile({
          radialDispatch: [
            dispatchRow({ container: "LOST0000001", pi: 100000009, qty: 3 }),
          ],
        })) as any,
        ops,
      );

      const container = containerByNumber(repos.containerRepo, "LOST0000001");
      expect(container).toMatchObject({ customer: { id: "cust-1" } });
      expect(container.port ?? null).toBeNull();
      expect(container.sourceEtd ?? null).toBeNull();
      expect(linesOf(repos.containerLineRepo, container.id)).toHaveLength(1);
      expect(result.actualContainers.containersWithoutTransportData).toBe(1);
    });

    it("does not touch existing containers or lines when the file has no shipped-container sheets", async () => {
      const { uploads, repos } = setup();
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [containerRow({ container: "AAAA1111111" })],
          radialDispatch: [
            dispatchRow({ container: "AAAA1111111", pi: 100000001, qty: 5 }),
          ],
        })) as any,
        ops,
      );
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Radial BO");
      sheet.addRow(["MaterialNum", "Quotation", "Quantity"]);
      sheet.addRow(["107071", 100037320, 2]);
      const onlyBo = {
        originalname: "bo-only.xlsx",
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      };

      const result = await uploads.upload(onlyBo as any, ops);

      expect(repos.containerRepo.rows).toHaveLength(1);
      expect(repos.containerLineRepo.rows).toHaveLength(1);
      expect(result.actualContainers).toMatchObject({
        containersCreated: 0,
        containersReplaced: 0,
        dispatchLinesStored: 0,
      });
    });
  });

  describe("shipped_qty on the PI cards", () => {
    const shipped = (repo: ReturnType<typeof makeFakeRepo>, pi: string) =>
      repo.rows.find((r) => r.piNumber === pi)!.shippedQty;

    it("sums every line with that PI number over several containers", async () => {
      const { uploads, repos } = setup();

      const result = await uploads.upload(
        (await buildWeeklyFile({
          bo: [boRow(100035541, "106907"), boRow(100035801, "107544")],
          containers: [
            containerRow({ container: "AAAA1111111" }),
            containerRow({ container: "BBBB2222222" }),
            containerRow({ container: "CCCC3333333" }),
          ],
          radialDispatch: [
            dispatchRow({ container: "AAAA1111111", pi: 100035541, qty: 10 }),
            dispatchRow({ container: "BBBB2222222", pi: 100035541, qty: 7 }),
            dispatchRow({ container: "CCCC3333333", pi: 100035541, qty: 3 }),
            dispatchRow({ container: "CCCC3333333", pi: 100035801, qty: 4 }),
          ],
        })) as any,
        ops,
      );

      expect(shipped(repos.piRepo, "100035541")).toBe("20.00");
      expect(shipped(repos.piRepo, "100035801")).toBe("4.00");
      expect(result.actualContainers.cardsShippedQtyChanged).toBe(2);
    });

    it("counts Radial and Bias lines of the same PI together and ignores PI numbers that have no card", async () => {
      const { uploads, repos } = setup();

      await uploads.upload(
        (await buildWeeklyFile({
          bo: [boRow(100035541, "106907")],
          containers: [containerRow({ container: "AAAA1111111" })],
          radialDispatch: [
            dispatchRow({ container: "AAAA1111111", pi: 100035541, qty: 5 }),
          ],
          biasDispatch: [
            dispatchRow({
              container: "AAAA1111111",
              pi: 100035541,
              qty: 8,
              category: "Bias",
            }),
            dispatchRow({
              container: "AAAA1111111",
              pi: 999999999,
              qty: 50,
              category: "Bias",
            }),
          ],
        })) as any,
        ops,
      );

      expect(shipped(repos.piRepo, "100035541")).toBe("13.00");
      expect(repos.piRepo.rows).toHaveLength(1);
    });

    it("recomputes from scratch: the same file again does not double it, a smaller file lowers it", async () => {
      const { uploads, repos } = setup();
      const week1 = await buildWeeklyFile({
        bo: [boRow(100035541, "106907")],
        containers: [containerRow({ container: "AAAA1111111" })],
        radialDispatch: [
          dispatchRow({ container: "AAAA1111111", pi: 100035541, qty: 6 }),
          dispatchRow({
            container: "AAAA1111111",
            pi: 100035541,
            qty: 4,
            material: 2,
          }),
        ],
      });
      await uploads.upload(week1 as any, ops);
      expect(shipped(repos.piRepo, "100035541")).toBe("10.00");

      const again = await uploads.upload(week1 as any, ops);
      expect(shipped(repos.piRepo, "100035541")).toBe("10.00");
      expect(again.actualContainers.cardsShippedQtyChanged).toBe(0);

      await uploads.upload(
        (await buildWeeklyFile({
          bo: [boRow(100035541, "106907")],
          containers: [containerRow({ container: "AAAA1111111" })],
          radialDispatch: [
            dispatchRow({ container: "AAAA1111111", pi: 100035541, qty: 6 }),
          ],
        })) as any,
        ops,
      );
      expect(shipped(repos.piRepo, "100035541")).toBe("6.00");
    });

    it("counts history that is no longer in the file: a container that dropped out keeps contributing", async () => {
      const { uploads, repos } = setup();
      await uploads.upload(
        (await buildWeeklyFile({
          bo: [boRow(100035541, "106907")],
          containers: [containerRow({ container: "AAAA1111111" })],
          radialDispatch: [
            dispatchRow({ container: "AAAA1111111", pi: 100035541, qty: 6 }),
          ],
        })) as any,
        ops,
      );

      await uploads.upload(
        (await buildWeeklyFile({
          bo: [boRow(100035541, "106907")],
          containers: [containerRow({ container: "BBBB2222222" })],
          radialDispatch: [
            dispatchRow({ container: "BBBB2222222", pi: 100035541, qty: 5 }),
          ],
        })) as any,
        ops,
      );

      expect(shipped(repos.piRepo, "100035541")).toBe("11.00");
    });

    it("updates archived cards too and leaves a card with no shipments at 0", async () => {
      const { uploads, repos } = setup();
      repos.piRepo.seed({
        id: "pi-old",
        piNumber: "100000777",
        isArchivedShipped: true,
        shippedQty: "0.00",
        customer: { id: "cust-1" },
      });

      await uploads.upload(
        (await buildWeeklyFile({
          bo: [boRow(100035541, "106907")],
          containers: [containerRow({ container: "AAAA1111111" })],
          radialDispatch: [
            dispatchRow({ container: "AAAA1111111", pi: 100000777, qty: 12 }),
          ],
        })) as any,
        ops,
      );

      expect(shipped(repos.piRepo, "100000777")).toBe("12.00");
      expect(
        repos.piRepo.rows.find((r) => r.piNumber === "100000777")!
          .isArchivedShipped,
      ).toBe(true);
      expect(Number(shipped(repos.piRepo, "100035541") ?? 0)).toBe(0);
    });
  });

  describe("override dates through the whole cycle", () => {
    it("override survives a repeat upload, and reset-dates returns the display to the newest file value", async () => {
      const { uploads, containers, repos } = setup();
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "BEAU6469435", etd: "2026-04-05" }),
          ],
        })) as any,
        ops,
      );
      const id = containerByNumber(repos.containerRepo, "BEAU6469435").id;
      await containers.updateDates(id, { overrideEtd: "2026-05-01" }, ops);
      await uploads.upload(
        (await buildWeeklyFile({
          containers: [
            containerRow({ container: "BEAU6469435", etd: "2026-04-09" }),
          ],
        })) as any,
        ops,
      );

      const kept = containerByNumber(repos.containerRepo, "BEAU6469435");
      expect([kept.overrideEtd, kept.sourceEtd]).toEqual([
        "2026-05-01",
        "2026-04-09",
      ]);

      await containers.resetDates(id, ops);

      const reset = containerByNumber(repos.containerRepo, "BEAU6469435");
      expect([reset.overrideEtd, reset.overrideEta, reset.sourceEtd]).toEqual([
        null,
        null,
        "2026-04-09",
      ]);
    });
  });

  describe("snapshots", () => {
    it("archives every row of every sheet, and the next upload adds to it instead of replacing it", async () => {
      const { uploads, repos } = setup();
      const file = await buildWeeklyFile({
        summary: true,
        bo: [boRow(100035541, "106907")],
        containers: [containerRow({ container: "AAAA1111111" })],
        radialDispatch: [
          dispatchRow({ container: "AAAA1111111", pi: 100035541, qty: 5 }),
        ],
        eta15: [eta15Row({ container: "AAAA1111111" })],
      });

      const first = await uploads.upload(file as any, ops);

      const perSheet = (uploadId: string) => {
        const counts: Record<string, number> = {};
        for (const row of repos.snapshotRepo.rows.filter(
          (r) => r.backorderUpload.id === uploadId,
        )) {
          counts[row.sheetName] = (counts[row.sheetName] ?? 0) + 1;
        }
        return counts;
      };
      // header row + data rows, per sheet; the empty Bias Dispatch keeps only its header
      expect(perSheet(first.id)).toEqual({
        Summary: 3,
        "Radial BO": 2,
        "Radial Dispatch": 2,
        "Bias Dispatch": 1,
        "ETD-ETA": 2,
        "ETA-15 days": 2,
      });
      expect(first.snapshotRows).toBe(12);

      const second = await uploads.upload(file as any, ops);

      expect(repos.snapshotRepo.rows).toHaveLength(24);
      expect(perSheet(first.id)).toEqual(perSheet(second.id));
    });

    it("exports one upload's snapshot back to the same sheets and cells", async () => {
      const { uploads } = setup();
      const source = await buildWeeklyFile({
        summary: true,
        bo: [boRow(100035541, "106907")],
        containers: [
          containerRow({ container: "AAAA1111111", etd: "2026-04-05" }),
        ],
        radialDispatch: [
          dispatchRow({ container: "AAAA1111111", pi: 100035541, qty: 5 }),
        ],
      });
      const upload = await uploads.upload(source as any, ops);

      const { buffer, fileName } = await uploads.exportSnapshot(upload.id);

      expect(fileName).toMatch(
        /^Backorder_snapshot_\d{4}-\d{2}-\d{2}_[0-9a-zA-Z-]{1,8}\.xlsx$/,
      );
      const exported = new ExcelJS.Workbook();
      await exported.xlsx.load(buffer as any);
      const original = new ExcelJS.Workbook();
      await original.xlsx.load(source.buffer as any);
      expect(exported.worksheets.map((s) => s.name)).toEqual(
        original.worksheets.map((s) => s.name),
      );
      const cell = (wb: ExcelJS.Workbook, sheet: string, address: string) =>
        wb.getWorksheet(sheet)!.getCell(address).value;
      expect(cell(exported, "Radial Dispatch", "H2")).toBe(5);
      expect(cell(exported, "Radial Dispatch", "I2")).toBe("AAAA1111111");
      expect(cell(exported, "ETD-ETA", "E2")).toEqual(
        cell(original, "ETD-ETA", "E2"),
      );
      expect(cell(exported, "ETD-ETA", "E2")).toBeInstanceOf(Date);
      expect(cell(exported, "Radial BO", "G2")).toBe(100035541);
    });

    it("404s the export of an upload that does not exist", async () => {
      const { uploads } = setup();

      await expect(uploads.exportSnapshot("nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe("ActualContainer effective dates", () => {
  it("shows the override when set, else the file's date", () => {
    const container = Object.assign(new ActualContainer(), {
      sourceEtd: "2026-04-05",
      sourceEta: null,
      overrideEtd: "2026-04-12",
      overrideEta: null,
    });

    expect(container.etd).toBe("2026-04-12");
    expect(container.isEtdOverridden).toBe(true);
    expect(container.eta).toBeNull();
    expect(container.isEtaOverridden).toBe(false);
  });
});
