import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen } from '../shared/serve.js';

const port = Number(process.env.PORT ?? 4175);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

listen(port, publicDir, async () => false);
