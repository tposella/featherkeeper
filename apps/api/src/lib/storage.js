import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Photos live under DATA_DIR/photos/<2-char shard>/<uuid>/ as:
 *   original.<ext>  the uploaded file, byte for byte
 *   display.webp    max 2048 px, metadata stripped (what viewers see)
 *   thumb.webp      480 px square crop, metadata stripped
 */
export function createStorage(dataDir) {
  const root = path.resolve(dataDir, 'photos');

  function dirFor(key) {
    if (!/^[0-9a-f]{2}\/[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid storage key');
    return path.join(root, key);
  }

  return {
    root,
    async ensureReady() {
      await mkdir(root, { recursive: true });
    },
    newKey() {
      const id = randomUUID();
      return `${id.slice(0, 2)}/${id}`;
    },
    async save(key, files) {
      const dir = dirFor(key);
      await mkdir(dir, { recursive: true });
      for (const [name, data] of Object.entries(files)) {
        const tmp = path.join(dir, `.${name}.tmp`);
        await writeFile(tmp, data);
        await rename(tmp, path.join(dir, name));
      }
    },
    async open(key, name) {
      const file = path.join(dirFor(key), name);
      const info = await stat(file);
      return { stream: createReadStream(file), size: info.size };
    },
    async remove(key) {
      await rm(dirFor(key), { recursive: true, force: true });
    },
  };
}
