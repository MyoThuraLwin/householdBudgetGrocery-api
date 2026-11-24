import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed-auth.ts' },
  datasource: { url: process.env.DATABASE_URL ?? 'sqlserver://localhost;database=HouseholdBudgetGrocery;integratedSecurity=true;trustServerCertificate=true' },
});
