import {
  buildContainerArrivalExpectedContent,
  buildContainerReopenedForClientContent,
  buildPiReadyToSignContent,
  buildPiReplacementProposedContent,
} from "./build-notification-content";

describe("buildPiReadyToSignContent", () => {
  it("uses the plain PI number when there is no label", () => {
    const content = buildPiReadyToSignContent({
      piNumber: "100037115",
      label: null,
      customerId: "cust-1",
    });
    expect(content.subject).toBe(
      "Проформа 100037115 готова к подписанию / Proforma 100037115 is ready to sign",
    );
    expect(content.text).toContain("Проформа 100037115 готова к подписанию.");
    expect(content.text).toContain("Proforma 100037115 is ready to sign.");
  });

  it("appends the label with the same '{number}: {label}' convention as the frontend", () => {
    const content = buildPiReadyToSignContent({
      piNumber: "100037115",
      label: "Орел",
      customerId: "cust-1",
    });
    expect(content.subject).toContain("100037115: Орел готова к подписанию");
    expect(content.subject).toContain("100037115: Орел is ready to sign");
  });
});

describe("buildPiReplacementProposedContent", () => {
  it("builds bilingual subject and text", () => {
    const content = buildPiReplacementProposedContent({
      piNumber: "100037115",
      label: null,
      customerId: "cust-1",
    });
    expect(content.subject).toBe(
      "CEAT предложил замену файла проформы 100037115 / CEAT proposed a replacement file for proforma 100037115",
    );
    expect(content.text).toContain(
      "CEAT предложил замену файла проформы 100037115.",
    );
    expect(content.text).toContain(
      "CEAT proposed a replacement file for proforma 100037115.",
    );
  });
});

describe("buildContainerReopenedForClientContent", () => {
  it("builds bilingual subject and text", () => {
    const content = buildContainerReopenedForClientContent({
      label: "Контейнер 3",
      customerId: "cust-1",
    });
    expect(content.subject).toBe(
      "Контейнер Контейнер 3 предложен на подтверждение / Container Контейнер 3 is ready for your confirmation",
    );
    expect(content.text).toContain("предложен на подтверждение.");
    expect(content.text).toContain("is ready for your confirmation.");
  });
});

describe("buildContainerArrivalExpectedContent", () => {
  it("includes the container number, day count and ETA in both languages", () => {
    const content = buildContainerArrivalExpectedContent({
      containerNumber: "MSKU1234567",
      customerId: "cust-1",
      eta: "2026-10-05",
      daysUntilEta: 5,
    });
    expect(content.subject).toBe(
      "Контейнер MSKU1234567 ожидается через 5 дней (ETA 2026-10-05) / Container MSKU1234567 expected in 5 days (ETA 2026-10-05)",
    );
    expect(content.text).toContain(
      "Контейнер MSKU1234567 ожидается через 5 дней (ETA 2026-10-05).",
    );
    expect(content.text).toContain(
      "Container MSKU1234567 expected in 5 days (ETA 2026-10-05).",
    );
  });
});
