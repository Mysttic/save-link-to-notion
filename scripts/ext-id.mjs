// Computes the ID Chrome assigns to an unpacked extension: first 16 bytes of
// SHA-256 of the absolute path, each nibble mapped to a-p. Windows hashes the
// path as UTF-16LE; the UTF-8 variant is printed as a fallback.
import { createHash } from 'node:crypto';

const toId = (buffer) =>
    Array.from(createHash('sha256').update(buffer).digest().subarray(0, 16))
        .map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15)))
        .join('');

const path = process.argv[2] ?? 'C:\\Workspaces\\save-link-to-notion\\dist';
console.log('utf16le:', toId(Buffer.from(path, 'utf16le')));
console.log('utf8:   ', toId(Buffer.from(path, 'utf8')));
