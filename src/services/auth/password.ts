import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const PREFIX = "scrypt";

export function isPasswordHash(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${PREFIX}$`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return `${PREFIX}$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<{ valid: boolean; needsMigration: boolean }> {
  if (!isPasswordHash(stored)) {
    const left = Buffer.from(password);
    const right = Buffer.from(stored || "");
    return { valid: left.length === right.length && crypto.timingSafeEqual(left, right), needsMigration: true };
  }
  const [, salt, encoded] = stored.split("$");
  if (!salt || !encoded) return { valid: false, needsMigration: false };
  const expected = Buffer.from(encoded, "base64url");
  const actual = await scryptAsync(password, salt, expected.length) as Buffer;
  return { valid: expected.length === actual.length && crypto.timingSafeEqual(expected, actual), needsMigration: false };
}
