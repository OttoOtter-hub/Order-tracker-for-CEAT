import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { UsersService } from "../users/users.service";
import { EmailService } from "./email.service";
import {
  ContainerArrivalExpectedPayload,
  LoadListEventPayload,
  NotificationEvent,
  PiReadyToSignPayload,
  PiReplacementProposedPayload,
} from "./notification-events";
import {
  buildContainerArrivalExpectedContent,
  buildLoadListAcceptedContent,
  buildLoadListApprovedContent,
  buildLoadListEditRequestedContent,
  buildLoadListRejectedContent,
  buildLoadListSentContent,
  buildLoadListSubmittedContent,
  buildPiReadyToSignContent,
  buildPiReplacementProposedContent,
  EmailContent,
} from "./utils/build-notification-content";

/**
 * One handler per trigger. Recipients: the PI events go only to that
 * customer's client users; arrival expected goes to its clients and every
 * ops user; the load list (Phase 25) to the clients when CEAT acts, to every
 * ops user when the client does. (Phase 13's "container reopened for you"
 * is gone: an unlock is CEAT reworking the load list now, and the client
 * hears of it when it is sent again.)
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

  // Phase 25: the load list. To the customer's client users:
  @OnEvent(NotificationEvent.LOAD_LIST_SENT)
  onLoadListSent(p: LoadListEventPayload): Promise<void> {
    return this.toClients(p, buildLoadListSentContent());
  }

  @OnEvent(NotificationEvent.LOAD_LIST_APPROVED)
  onLoadListApproved(p: LoadListEventPayload): Promise<void> {
    return this.toClients(p, buildLoadListApprovedContent());
  }

  @OnEvent(NotificationEvent.LOAD_LIST_REJECTED)
  onLoadListRejected(p: LoadListEventPayload): Promise<void> {
    return this.toClients(p, buildLoadListRejectedContent(p));
  }

  // … and to every ops user:
  @OnEvent(NotificationEvent.LOAD_LIST_ACCEPTED)
  onLoadListAccepted(p: LoadListEventPayload): Promise<void> {
    return this.toOps(buildLoadListAcceptedContent(p));
  }

  @OnEvent(NotificationEvent.LOAD_LIST_EDIT_REQUESTED)
  onLoadListEditRequested(p: LoadListEventPayload): Promise<void> {
    return this.toOps(buildLoadListEditRequestedContent(p));
  }

  @OnEvent(NotificationEvent.LOAD_LIST_SUBMITTED)
  onLoadListSubmitted(p: LoadListEventPayload): Promise<void> {
    return this.toOps(buildLoadListSubmittedContent(p));
  }

  private async toClients(
    p: LoadListEventPayload,
    content: EmailContent,
  ): Promise<void> {
    const recipients = await this.usersService.findClientUsers(p.customerId);
    await this.send(
      recipients.map((u) => u.email),
      content,
    );
  }

  private async toOps(content: EmailContent): Promise<void> {
    const recipients = await this.usersService.findOpsUsers();
    await this.send(
      recipients.map((u) => u.email),
      content,
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
