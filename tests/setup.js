import { beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer;

beforeAll(async () => {
  process.env.JWT_SECRET = 'jwt-secret';
  process.env.JWT_SECRET_RIDER = 'test-secret-rider';
  process.env.JWT_SECRET_ADMIN = 'test-secret-admin';
  process.env.JWT_SECRET_STORE = 'test-secret-store';

  // Garante que não há conexão anterior
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  await mongoose.connect(uri);

  // Confirma que conectou
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Falha ao conectar no MongoMemoryServer');
  }

  console.log('MongoMemoryServer conectado:', uri);
}, 60000);

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}, 60000);