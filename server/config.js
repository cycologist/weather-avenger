import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const PORT = Number(process.env.PORT) || 4173;

export const CONTACT = process.env.CONTACT_EMAIL || '';
export const USER_AGENT = CONTACT
  ? `Avercast/1.0 (contact: ${CONTACT})`
  : 'Avercast/1.0 (local weather aggregator)';

export { DEFAULT_SOURCE_ORDER } from '../public/lib/catalog.js';
