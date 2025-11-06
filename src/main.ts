import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { corsConfig } from './config/cors.config';
import * as dotenv from 'dotenv';

dotenv.config();

import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { ReflectionService } from '@grpc/reflection';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const combinedProtoPath = [
    join(process.cwd(), '/src/proto', 'health.proto'),
    join(process.cwd(), '/src/proto', 'chat.proto'),
    join(process.cwd(), '/src/proto', 'voice-chat.proto'),
  ];

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: [
        'grpc.health.v1',
        'chat.v1',
        'voicechat.v1',
      ],
      protoPath: combinedProtoPath,
      url: `0.0.0.0:${process.env.GRPC_PORT || '50051'}`,
      onLoadPackageDefinition: (pkg, server) => {
        new ReflectionService(pkg).addToServer(server);
      },
    },
  });

  // Configure CORS
  app.enableCors(corsConfig);

  await app.startAllMicroservices();
  const port = parseInt(process.env.PORT || '3007', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`App running at http://localhost:${port}`);
  console.log(
    `gRPC server running at 0.0.0.0:${process.env.GRPC_PORT || '50051'}`,
  );
}
void bootstrap();

