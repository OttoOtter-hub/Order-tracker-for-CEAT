import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { EmailService } from "./email.service";
import { NotificationsListener } from "./notifications.listener";

@Module({
  imports: [UsersModule],
  providers: [EmailService, NotificationsListener],
  exports: [EmailService],
})
export class NotificationsModule {}
