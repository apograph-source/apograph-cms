import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/lib/infrastructure/schema/index.ts',
    out: './migrations'
});
