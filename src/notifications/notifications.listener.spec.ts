import { NotificationsListener } from "./notifications.listener";

function setup() {
  const emailService = { send: jest.fn(async () => undefined) };
  const usersService = {
    findClientUsers: jest.fn(async () => [] as { email: string }[]),
    findOpsUsers: jest.fn(async () => [] as { email: string }[]),
  };
  const listener = new NotificationsListener(
    emailService as any,
    usersService as any,
  );
  return { listener, emailService, usersService };
}

describe("NotificationsListener", () => {
  it("event 1 — pi.ready-to-sign goes only to that customer's clients", async () => {
    const { listener, emailService, usersService } = setup();
    usersService.findClientUsers.mockResolvedValue([
      { email: "buyer@mtkrosberg.com" },
      { email: "buyer2@mtkrosberg.com" },
    ]);

    await listener.onPiReadyToSign({
      piNumber: "100037115",
      label: null,
      customerId: "cust-1",
    });

    expect(usersService.findClientUsers).toHaveBeenCalledWith("cust-1");
    expect(usersService.findOpsUsers).not.toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalledWith(
      ["buyer@mtkrosberg.com", "buyer2@mtkrosberg.com"],
      "Проформа 100037115 готова к подписанию / Proforma 100037115 is ready to sign",
      expect.stringContaining("Proforma 100037115 is ready to sign."),
    );
  });

  it("event 2 — pi.replacement-proposed goes only to that customer's clients", async () => {
    const { listener, emailService, usersService } = setup();
    usersService.findClientUsers.mockResolvedValue([
      { email: "buyer@mtkrosberg.com" },
    ]);

    await listener.onPiReplacementProposed({
      piNumber: "100037115",
      label: "Орел",
      customerId: "cust-1",
    });

    expect(usersService.findOpsUsers).not.toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalledWith(
      ["buyer@mtkrosberg.com"],
      "CEAT предложил замену файла проформы 100037115 / CEAT proposed a replacement file for proforma 100037115",
      expect.any(String),
    );
  });

  it("event 3 — container.reopened-for-client goes only to that customer's clients", async () => {
    const { listener, emailService, usersService } = setup();
    usersService.findClientUsers.mockResolvedValue([
      { email: "buyer@mtkrosberg.com" },
    ]);

    await listener.onContainerReopenedForClient({
      label: "Контейнер 1",
      customerId: "cust-1",
    });

    expect(usersService.findClientUsers).toHaveBeenCalledWith("cust-1");
    expect(usersService.findOpsUsers).not.toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalledWith(
      ["buyer@mtkrosberg.com"],
      expect.stringContaining("Контейнер 1 предложен на подтверждение"),
      expect.any(String),
    );
  });

  it("event 4 — container.arrival-expected goes to both that customer's clients and all ops", async () => {
    const { listener, emailService, usersService } = setup();
    usersService.findClientUsers.mockResolvedValue([
      { email: "buyer@mtkrosberg.com" },
    ]);
    usersService.findOpsUsers.mockResolvedValue([
      { email: "ops1@ceat.com" },
      { email: "ops2@ceat.com" },
    ]);

    await listener.onContainerArrivalExpected({
      containerNumber: "MSKU1234567",
      customerId: "cust-1",
      eta: "2026-10-05",
      daysUntilEta: 5,
    });

    expect(usersService.findClientUsers).toHaveBeenCalledWith("cust-1");
    expect(usersService.findOpsUsers).toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalledWith(
      ["buyer@mtkrosberg.com", "ops1@ceat.com", "ops2@ceat.com"],
      expect.stringContaining("MSKU1234567"),
      expect.any(String),
    );
  });

  it("still calls send with an empty recipient list when nobody matches — EmailService is what logs the warning, not the listener", async () => {
    const { listener, emailService, usersService } = setup();
    usersService.findClientUsers.mockResolvedValue([]);

    await listener.onPiReadyToSign({
      piNumber: "100037115",
      label: null,
      customerId: "cust-with-no-users",
    });

    expect(emailService.send).toHaveBeenCalledWith(
      [],
      expect.any(String),
      expect.any(String),
    );
  });
});
