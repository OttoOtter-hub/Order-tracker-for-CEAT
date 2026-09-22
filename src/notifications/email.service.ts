import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/**
 * Thin nodemailer wrapper. SMTP is optional: EMAIL_HOST/EMAIL_USER/
 * EMAIL_PASSWORD blank (the pilot's default — see .env.example) means no
 * transporter is built at all, and send() logs and returns instead of
 * throwing, so a missing SMTP setup never fails the action that triggered
 * the notification (an upload, a confirm, the daily cron).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>(
      "EMAIL_FROM",
      "noreply@ceat-order-track.local",
    );
    this.transporter = this.buildTransporter(config);
  }

  private buildTransporter(config: ConfigService): Transporter | null {
    const host = config.get<string>("EMAIL_HOST");
    const user = config.get<string>("EMAIL_USER");
    const password = config.get<string>("EMAIL_PASSWORD");
    if (!host || !user || !password) {
      return null;
    }
    const port = Number(config.get<string>("EMAIL_PORT", "587"));
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
    });
  }

  async send(to: string[], subject: string, text: string): Promise<void> {
    if (to.length === 0) {
      this.logger.warn(`email not sent: no recipients for "${subject}"`);
      return;
    }
    if (!this.transporter) {
      this.logger.log(`email not sent: SMTP not configured ("${subject}")`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        text,
      });
      this.logger.log(`email sent to ${to.join(", ")}: "${subject}"`);
    } catch (err) {
      // A notification failing to send must never fail the triggering
      // action (an upload, a confirm, the daily cron) — log and move on.
      this.logger.error(
        `email failed to send to ${to.join(", ")}: "${subject}" — ${(err as Error).message}`,
      );
    }
  }
}
