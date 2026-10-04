// Tiny ULID (26-char Crockford base32: 48-bit ms timestamp + 80-bit random).
// Good enough for event ids: sort-friendly, collision-negligible, no dep.
import { randomBytes } from "node:crypto";

const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now = Date.now()) {
  let ts = now;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ENC[ts % 32] + out;
    ts = Math.floor(ts / 32);
  }
  const rnd = randomBytes(10);
  for (let i = 0; i < 16; i++) {
    const byte = rnd[i >> 1];
    const nib = i % 2 ? byte & 0x0f : byte >> 4;
    out += ENC[nib];
  }
  return out;
}
