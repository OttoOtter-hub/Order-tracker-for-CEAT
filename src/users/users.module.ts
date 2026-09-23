import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Customer } from "../customers/customer.entity";
import { User } from "./user.entity";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * Users are created by ops through /users (Phase 20a) — there is still no
 * public registration. The seed script (src/seed/create-user.ts) remains for
 * the very first ops account on a fresh database.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, Customer])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [TypeOrmModule, UsersService],
})
export class UsersModule {}
