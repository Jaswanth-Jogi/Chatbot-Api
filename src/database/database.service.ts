import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mongoose from 'mongoose';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private mongoConnection: mongoose.Connection | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeMongoDB();
  }

  async onModuleDestroy() {
    await this.closeMongoConnection();
  }

  private async initializeMongoDB() {
    const mongoUri = this.configService.get<string>('MONGODB_URI');
    if (mongoUri) {
      try {
        await mongoose.connect(mongoUri);
        this.mongoConnection = mongoose.connection;
        console.log('MongoDB connected successfully');
      } catch (error) {
        console.error('MongoDB connection failed:', error);
        throw error;
      }
    } else {
      console.log('MongoDB URI not provided, skipping MongoDB initialization');
    }
  }

  private async closeMongoConnection() {
    if (this.mongoConnection) {
      await mongoose.disconnect();
      console.log('MongoDB connection closed');
    }
  }

  getMongoConnection() {
    return this.mongoConnection;
  }

  checkMongoHealth() {
    if (!this.mongoConnection) {
      return { status: 'skipped', reason: 'MongoDB not initialized' };
    }

    try {
      const state = this.mongoConnection.readyState;
      // MongoDB connection states: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
      if (state === 1) {
        return { status: 'up' };
      } else {
        return { status: 'down', error: `Connection state: ${state}` };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return { status: 'down', error: errorMessage };
    }
  }
}

