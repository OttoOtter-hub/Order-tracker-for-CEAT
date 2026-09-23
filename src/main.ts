import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { validationExceptionFactory } from "./common/errors/api-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
    credentials: true,
    // Browsers hide response headers from cross-origin fetch() by default
    // unless explicitly exposed — the xlsx export endpoints' filenames live
    // in Content-Disposition, which the frontend reads to name the saved
    // file (see frontend/src/lib/download.ts). Same-origin (prod, behind
    // the nginx /api/ proxy) doesn't need this, but local dev is
    // cross-origin (5173 -> 3000).
    exposedHeaders: ["Content-Disposition"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle("CEAT Order Tracking API")
    .setDescription(
      "v2 Phase 4 (frontend PI-card screens) plus a Phase 3 fix-up: POST /backorder-uploads now actually archives cards missing from the latest snapshot, un-archives ones that reappear, and reports cardsArchived/cardsSkippedInvalidRows.",
    )
    .setVersion("2.0.0-alpha.12")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`CEAT Order Tracking API listening on port ${port}`);
  // eslint-disable-next-line no-console
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
