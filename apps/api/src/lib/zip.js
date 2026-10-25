import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { crc32 } from 'node:zlib';

/**
 * A minimal streaming ZIP writer for exports. Entries are stored, not compressed (photos are already
 * compressed, and it keeps memory flat), and written straight to the output stream as they're added,
 * so an export of any size never sits in memory. Uses data descriptors (sizes after the data) and
 * ZIP64 records when the archive passes 4 GB or 65,535 entries. Single entries must be under 4 GB.
 *
 *   const zip = createZip();
 *   reply.send(zip.stream);
 *   await zip.addBuffer('README.txt', Buffer.from('hi'));
 *   await zip.addFile('photos/a.jpg', '/data/photos/.../original.jpg', date);
 *   await zip.finish();
 */
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** `limits` lowers the ZIP64 thresholds, only so tests can exercise those records with small files. */
export function createZip({ limits = { offset: MAX32, count: MAX16 } } = {}) {
  const stream = new PassThrough();
  const entries = [];
  const names = new Set();
  let offset = 0;
  let finished = false;

  async function write(buf) {
    offset += buf.length;
    if (!stream.write(buf)) await once(stream, 'drain');
  }

  function uniqueName(name) {
    const clean = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!names.has(clean)) {
      names.add(clean);
      return clean;
    }
    const dot = clean.lastIndexOf('.');
    const [base, ext] = dot > clean.lastIndexOf('/') ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
    for (let i = 2; ; i += 1) {
      const candidate = `${base} (${i})${ext}`;
      if (!names.has(candidate)) {
        names.add(candidate);
        return candidate;
      }
    }
  }

  /** Write one entry whose data comes from an async iterable of Buffers. */
  async function addEntry(rawName, chunks, mtime) {
    if (finished) throw new Error('zip already finished');
    const name = Buffer.from(uniqueName(rawName), 'utf8');
    const { time, date } = dosDateTime(mtime);
    const headerOffset = offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0808, 6); // bit 3: sizes in a data descriptor; bit 11: UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // crc and sizes (14..25) stay zero: they follow the data.
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await write(local);
    await write(name);

    let crc = 0;
    let size = 0;
    for await (const chunk of chunks) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      if (size >= MAX32) throw new Error(`${rawName} is too large for this export (4 GB per file)`);
      await write(chunk);
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    await write(descriptor);

    entries.push({ name, time, date, crc: crc >>> 0, size, headerOffset });
  }

  async function finish() {
    if (finished) return;
    finished = true;
    const cdStart = offset;
    for (const e of entries) {
      const big = e.headerOffset >= limits.offset;
      const extra = big ? Buffer.alloc(12) : Buffer.alloc(0);
      if (big) {
        extra.writeUInt16LE(0x0001, 0); // ZIP64 extended information
        extra.writeUInt16LE(8, 2);
        extra.writeBigUInt64LE(BigInt(e.headerOffset), 4);
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE((3 << 8) | 45, 4); // made by: Unix, spec 4.5
      h.writeUInt16LE(big ? 45 : 20, 6);
      h.writeUInt16LE(0x0808, 8);
      h.writeUInt16LE(0, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.size, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt16LE(0, 32); // comment
      h.writeUInt16LE(0, 34); // disk
      h.writeUInt16LE(0, 36); // internal attributes
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
      h.writeUInt32LE(big ? MAX32 : e.headerOffset, 42);
      await write(h);
      await write(e.name);
      if (extra.length) await write(extra);
    }
    const cdSize = offset - cdStart;
    const zip64 = entries.length >= limits.count || cdStart >= limits.offset || cdSize >= limits.offset;

    if (zip64) {
      const recordOffset = offset;
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(0x06064b50, 0);
      rec.writeBigUInt64LE(44n, 4); // size of the rest of this record
      rec.writeUInt16LE((3 << 8) | 45, 12);
      rec.writeUInt16LE(45, 14);
      rec.writeUInt32LE(0, 16);
      rec.writeUInt32LE(0, 20);
      rec.writeBigUInt64LE(BigInt(entries.length), 24);
      rec.writeBigUInt64LE(BigInt(entries.length), 32);
      rec.writeBigUInt64LE(BigInt(cdSize), 40);
      rec.writeBigUInt64LE(BigInt(cdStart), 48);
      await write(rec);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeUInt32LE(0, 4);
      loc.writeBigUInt64LE(BigInt(recordOffset), 8);
      loc.writeUInt32LE(1, 16);
      await write(loc);
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(zip64 ? MAX16 : entries.length, 8);
    end.writeUInt16LE(zip64 ? MAX16 : entries.length, 10);
    end.writeUInt32LE(zip64 ? MAX32 : cdSize, 12);
    end.writeUInt32LE(zip64 ? MAX32 : cdStart, 16);
    end.writeUInt16LE(0, 20);
    await write(end);
    stream.end();
  }

  return {
    stream,
    addBuffer: (name, buf, mtime) => addEntry(name, [buf], mtime),
    async addFile(name, file, mtime) {
      await stat(file); // fail before writing a header if the file is missing
      return addEntry(name, createReadStream(file, { highWaterMark: 1024 * 1024 }), mtime);
    },
    finish,
  };
}
