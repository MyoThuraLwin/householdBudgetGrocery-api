import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../dist/vendor/', import.meta.url), { recursive: true });
await copyFile(new URL('../src/vendor/LICENSE-prisma.txt', import.meta.url), new URL('../dist/vendor/LICENSE-prisma.txt', import.meta.url));
