import fsSync from 'node:fs';
import path from 'node:path';

export function loadAppVersion(): string {
  try {
    const versionFile = path.resolve(process.cwd(), 'version.yml');
    const raw = fsSync.readFileSync(versionFile, 'utf8');
    const match = raw.match(/^\s*version\s*:\s*["']?([^\r\n"']+?)["']?\s*$/m);
    return match && match[1] ? match[1].trim() : 'local';
  } catch {
    return 'local';
  }
}

export const APP_VERSION = loadAppVersion();
