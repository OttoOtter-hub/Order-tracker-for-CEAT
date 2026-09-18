import { ClassSerializerInterceptor, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { JwtAuthGuard } from "./common/auth/jwt-auth.guard";
import { RolesGuard } from "./common/auth/roles.guard";
import { CustomerScopeInterceptor } from "./common/auth/customer-scope.interceptor";

import { CustomersModule } from "./customers/customers.module";
import { ProformaInvoicesModule } from "./proforma-invoices/proforma-invoices.module";
import { PiAdditionalFilesModule } from "./pi-additional-files/pi-additional-files.module";
import { PiLineItemsModule } from "./pi-line-items/pi-line-items.module";
import { BackorderUploadsModule } from "./backorder-uploads/backorder-uploads.module";
import { FilesModule } from "./files/files.module";
import { ReadyToShipModule } from "./ready-to-ship/ready-to-ship.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.get<string>("DB_HOST", "localhost"),
        port: config.get<number>("DB_PORT", 5432),
        username: config.get<string>("DB_USERNAME", "ceat"),
        password: config.get<string>("DB_PASSWORD", "ceat"),
        database: config.get<string>("DB_DATABASE", "ceat_order_track"),
        ssl:
          config.get<string>("DB_SSL", "false") === "true"
            ? { rejectUnauthorized: false }
            : false,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    AuthModule,
    UsersModule,
    CustomersModule,
    ProformaInvoicesModule,
    PiAdditionalFilesModule,
    PiLineItemsModule,
    BackorderUploadsModule,
    FilesModule,
    ReadyToShipModule,
  ],
  providers: [
    // Order matters: JwtAuthGuard authenticates (populates request.user),
    // then RolesGuard authorizes (ops full access / client read-only + scope).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // ClassSerializerInterceptor must run after CustomerScopeInterceptor has
    // filtered the raw entities, so it is registered first (outermost).
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: CustomerScopeInterceptor },
  ],
})
export class AppModule {}
