import { ProformaInvoice } from "./proforma-invoice.entity";
import { PiStatus } from "./enums/pi-status.enum";

function makePi(overrides: Partial<ProformaInvoice> = {}): ProformaInvoice {
  return Object.assign(new ProformaInvoice(), overrides);
}

describe("ProformaInvoice.status", () => {
  it("is missing_pi_document when no files have been uploaded", () => {
    expect(makePi().status).toBe(PiStatus.MISSING_PI_DOCUMENT);
  });

  it("is missing_signed_document once the PI file is uploaded", () => {
    expect(makePi({ piFileUrl: "x" }).status).toBe(
      PiStatus.MISSING_SIGNED_DOCUMENT,
    );
  });

  it("is signed once the signed file is uploaded", () => {
    expect(makePi({ piFileUrl: "x", signedFileUrl: "y" }).status).toBe(
      PiStatus.SIGNED,
    );
  });

  it("is replacement_pending when a replacement is proposed, even over signed", () => {
    expect(
      makePi({
        piFileUrl: "x",
        signedFileUrl: "y",
        pendingReplacementFileUrl: "z",
      }).status,
    ).toBe(PiStatus.REPLACEMENT_PENDING);
  });

  it("is archived_shipped once archived, regardless of everything else", () => {
    expect(
      makePi({
        piFileUrl: "x",
        signedFileUrl: "y",
        pendingReplacementFileUrl: "z",
        isArchivedShipped: true,
      }).status,
    ).toBe(PiStatus.ARCHIVED_SHIPPED);
  });
});

describe("ProformaInvoice.priorityTotalQty / priorityTotalContainers", () => {
  it("sums priorityQty across the loaded lineItems", () => {
    const pi = makePi({
      lineItems: [
        { priorityQty: "3.00", loadability: "20.0000" } as any,
        { priorityQty: "7.00", loadability: "20.0000" } as any,
      ],
    });
    expect(pi.priorityTotalQty).toBe(10);
    expect(pi.priorityTotalContainers).toBeCloseTo((3 + 7) / 20);
  });

  it("falls back to 0 rather than throwing when lineItems isn't loaded", () => {
    const pi = makePi();
    expect(pi.priorityTotalQty).toBe(0);
    expect(pi.priorityTotalContainers).toBe(0);
  });
});
