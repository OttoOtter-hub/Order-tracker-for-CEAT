import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { EmailService } from "./email.service";

jest.mock("nodemailer");

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe("EmailService", () => {
  afterEach(() => jest.clearAllMocks());

  it("does not build a transporter, and logs instead of sending, when SMTP is not configured", async () => {
    const service = new EmailService(
      configWith({ EMAIL_HOST: "", EMAIL_USER: "", EMAIL_PASSWORD: "" }),
    );
    expect(nodemailer.createTransport).not.toHaveBeenCalled();

    await expect(
      service.send(["client@x.com"], "subject", "text"),
    ).resolves.toBeUndefined();
  });

  it("warns and returns, without touching the transporter, when there are no recipients", async () => {
    const sendMail = jest.fn();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(
      configWith({
        EMAIL_HOST: "smtp.example.com",
        EMAIL_USER: "u",
        EMAIL_PASSWORD: "p",
      }),
    );

    await service.send([], "subject", "text");

    expect(sendMail).not.toHaveBeenCalled();
  });

  it("builds a transporter and sends when SMTP is fully configured", async () => {
    const sendMail = jest.fn(async () => undefined);
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

    const service = new EmailService(
      configWith({
        EMAIL_HOST: "smtp.example.com",
        EMAIL_PORT: "587",
        EMAIL_USER: "user@example.com",
        EMAIL_PASSWORD: "secret",
        EMAIL_FROM: "noreply@ceat-order-track.local",
      }),
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        auth: { user: "user@example.com", pass: "secret" },
      }),
    );

    await service.send(["client@x.com"], "subject", "text");

    expect(sendMail).toHaveBeenCalledWith({
      from: "noreply@ceat-order-track.local",
      to: ["client@x.com"],
      subject: "subject",
      text: "text",
    });
  });

  it("swallows a transport failure instead of throwing (never fails the triggering action)", async () => {
    const sendMail = jest.fn(async () => {
      throw new Error("connection refused");
    });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(
      configWith({
        EMAIL_HOST: "smtp.example.com",
        EMAIL_USER: "u",
        EMAIL_PASSWORD: "p",
      }),
    );

    await expect(
      service.send(["client@x.com"], "subject", "text"),
    ).resolves.toBeUndefined();
  });
});
