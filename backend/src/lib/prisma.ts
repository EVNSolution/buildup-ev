import { PrismaClient } from '@prisma/client';

// DATABASE_URL이 없으면(테스트·mock 환경) null 반환
export const prisma = process.env.DATABASE_URL
  ? new PrismaClient({ log: ['error'] })
  : null;
