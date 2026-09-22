import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { UsersService } from "../users/users.service";
import { EmailService } from "./email.service";
import {
  ContainerArrivalExpectedPayload,
  ContainerReopenedForClientPayload,
  NotificationEvent,
  PiReadyToSignPayload,
  PiReplacementProposedPayload,
} from "./notification-events";
import {
  buildContainerArrivalExpectedContent,
  buildContainerReopenedForClientContent,
  buildPiReadyToSignContent,
  buildPiReplacementProposedContent,
  EmailContent,
} from "./utils/build-notification-content";

/**
 * One handler per Phase 13 trigger. Recipients: client events (1-3) go only
 * to that customer's client users, not ops — the spec is explicit these are
 * client-facing unless said otherwise. Event 4 (arrival expected) goes to
 * both that customer's clients and every ops user.
 */
@Injectable()
export class NotificationsListener {
  constructor(
    private readonly emailService: EmailService,
    private readonly usersService: UsersService,
  ) {}

  @OnEvent(NotificationEvent.PI_READY_TO_SIGN)
  async onPiReadyToSign(payload: PiReadyToSignPayload): Promise<void> {
    const recipients = await this.usersService.findClientUsers(
      payload.customerId,
    );
    await this.send(
      recipients.map((u) => u.email),
      buildPiReadyToSignContent(payload),
    );
  }

  @OnEvent(NotificationEvent.PI_REPLACEMENT_PROPOSED)
  async onPiReplacementProposed(
    payload: PiReplacementProposedPayload,
  ): Promise<void> {
    const recipients = await this.usersService.findClientUsers(
      payload.customerId,
    );
    await this.send(
      recipients.map((u) => u.email),
      buildPiReplacementProposedContent(payload),
    );
  }

  @OnEvent(NotificationEvent.CONTAINER_REOPENED_FOR_CLIENT)
  async onContainerReopenedForClient(
    payload: ContainerReopenedForClientPayload,
  ): Promise<void> {
    const recipients = await this.usersService.findClientUsers(
      payload.customerId,
    );
    await this.send(
      recipients.map((u) => u.email),
      buildContainerReopenedForClientContent(payload),
    );
  }

  @OnEvent(NotificationEvent.CONTAINER_ARRIVAL_EXPECTED)
  async onContainerArrivalExpected(
    payload: ContainerArrivalExpectedPayload,
  ): Promise<void> {
    const [clients, ops] = await Promise.all([
      this.usersService.findClientUsers(payload.customerId),
      this.usersService.findOpsUsers(),
    ]);
    const recipients = [...clients, ...ops].map((u) => u.email);
    await this.send(recipients, buildContainerArrivalExpectedContent(payload));
  }

  private send(to: string[], content: EmailContent): Promise<void> {
    return this.emailService.send(to, content.subject, content.text);
  }
}
