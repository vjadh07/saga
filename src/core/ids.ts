import { randomBytes } from "node:crypto";

// base32hex lowercase: also a valid Google Calendar event id alphabet
const ALPHABET = "0123456789abcdefghijklmnopqrstuv";

export function mintActionId(): string {
  const bytes = randomBytes(26);
  let id = "";
  for (const b of bytes) id += ALPHABET[b & 31];
  return id;
}
