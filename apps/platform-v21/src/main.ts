import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Agent Collaboration Platform v2.1')
    .setDescription('Project modes + dual-agent routing + skill learning loop')
    .setVersion('2.1.0')
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, doc);

  const port = Number(process.env.PORT || 3310);
  await app.listen(port);
}

void bootstrap();
