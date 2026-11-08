import { copyFile, mkdir, access } from 'node:fs/promises';
await access(new URL('../apps/server/dist/bots/equity.worker.js', import.meta.url));
const destination = new URL('../apps/server/dist/persistence/migrations/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of [
  '001-initial.sql',
  '002-room-controls.sql',
  '003-accounts.sql',
  '004-google-auth.sql',
])
  await copyFile(
    new URL('../apps/server/src/persistence/migrations/' + name, import.meta.url),
    new URL(name, destination),
  );
console.log('Copied server SQL migration assets.');
