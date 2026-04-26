import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });
