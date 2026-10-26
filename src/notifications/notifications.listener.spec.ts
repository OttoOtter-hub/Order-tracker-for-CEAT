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

  it("Phase 25 — CEAT's load-list steps go to that customer's clients only", async () => {
    const { listener, emailService, usersService } = setup();
    usersService.findClientUsers.mockResolvedValue([
      { email: "buyer@mtkrosberg.com" },
    ]);
    const payload = { customerId: "cust-1", customerName: "MTK" };

    await listener.onLoadListSent(payload);
    await listener.onLoadListApproved(payload);
    await listener.onLoadListRejected({
      ...payload,
      comment: "Контейнер 3 перегружен",
      adjustments: [
        {
          containerLabel: "Контейнер 2",
          piNumber: "100037115",
          materialNum: "106259",
          wanted: 10,
          placed: 8,
        },
      ],
    });

    expect(usersService.findClientUsers).toHaveBeenCalledWith("cust-1");
    expect(usersService.findOpsUsers).not.toHaveBeenCalled();
    const subjects = (
      emailService.send.mock.calls as unknown as string[][]
    ).map((c) => c[1]);
    expect(subjects).toEqual([
      "CEAT отправил load list на согласование / CEAT sent you the load list for review",
      "CEAT подтвердил ваши правки load list / CEAT approved your changes to the load list",
      "CEAT отклонил ваши правки load list / CEAT rejected your changes to the load list",
    ]);
    const rejectionText = (
      emailService.send.mock.calls as unknown as string[][]
    )[2][2];
    expect(rejectionText).toContain("Комментарий CEAT: Контейнер 3 перегружен");
    expect(rejectionText).toContain(
      "106259 (PI 100037115), Контейнер 2: 10 → 8",
    );
  });

  it("Phase 25 — the client's load-list steps go to every ops user, naming the customer", async () => {
    const { listener, emailService, usersService } = setup();
    usersService.findOpsUsers.mockResolvedValue([{ email: "ops@ceat.com" }]);
    const payload = { customerId: "cust-1", customerName: "MTK ROSBERG" };

    await listener.onLoadListAccepted(payload);
    await listener.onLoadListEditRequested(payload);
    await listener.onLoadListSubmitted(payload);

    expect(usersService.findClientUsers).not.toHaveBeenCalled();
    expect(
      (emailService.send.mock.calls as unknown as string[][]).map((c) => [
        c[0],
        c[1],
      ]),
    ).toEqual([
      [
        ["ops@ceat.com"],
        "MTK ROSBERG: клиент принял load list / MTK ROSBERG: the client accepted the load list",
      ],
      [
        ["ops@ceat.com"],
        "MTK ROSBERG: клиент начал редактировать load list / MTK ROSBERG: the client is editing the load list",
      ],
      [
        ["ops@ceat.com"],
        "MTK ROSBERG: клиент отправил правки load list / MTK ROSBERG: the client submitted changes to the load list",
      ],
    ]);
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
