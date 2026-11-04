const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);

export function normalizeSecret(value) {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z2-7]+={0,6}$/.test(normalized)) {
    throw new Error("The secret must contain only letters A–Z and digits 2–7.");
  }
  const secret = normalized.replace(/=+$/, "");
  const remainder = secret.length % 8;
  if (![0, 2, 4, 5, 7].includes(remainder)) {
    throw new Error(
      "Invalid secret length. Make sure you copied the entire secret.",
    );
  }
  const expectedPadding = (8 - remainder) % 8;
  const padding = normalized.length - secret.length;
  if (padding && padding !== expectedPadding) {
    throw new Error("The padding at the end of the secret is invalid.");
  }
  if (secret.length < 16) {
    throw new Error(
      "The secret is too short. At least 16 Base32 characters are required.",
    );
  }
  const unusedBits = (secret.length * 5) % 8;
  if (unusedBits && BASE32.indexOf(secret.at(-1)) & ((1 << unusedBits) - 1)) {
    throw new Error(
      "The secret is not a valid Base32 value. Please copy it again.",
    );
  }
  return secret;
}

export function decodeBase32(value) {
  const secret = normalizeSecret(value);
  const bytes = [];
  let bits = 0;
  let buffer = 0;
  for (const char of secret) {
    buffer = (buffer << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(bytes);
}

export function validateParameters({
  algorithm = "SHA1",
  digits = 6,
  period = 30,
} = {}) {
  algorithm = String(algorithm).toUpperCase().replaceAll("-", "");
  digits = Number(digits);
  period = Number(period);
  if (!ALGORITHMS.has(algorithm))
    throw new Error("Only SHA1, SHA256, and SHA512 are supported.");
  if (![6, 8].includes(digits))
    throw new Error("Codes must be 6 or 8 digits long.");
  if (!Number.isInteger(period) || period < 1 || period > 300) {
    throw new Error("The refresh period must be between 1 and 300 seconds.");
  }
  return { algorithm, digits, period };
}

export function parseAccountInput(value, defaults = {}) {
  const input = value.trim();
  if (!/^otpauth:/i.test(input)) {
    return {
      secret: normalizeSecret(input),
      ...validateParameters(defaults),
      suggestedName: "",
    };
  }
  let uri;
  try {
    uri = new URL(input);
  } catch {
    throw new Error("The authentication link is invalid.");
  }
  if (uri.protocol !== "otpauth:" || uri.hostname !== "totp") {
    throw new Error("Only time-based otpauth://totp links are supported.");
  }
  const secret = normalizeSecret(uri.searchParams.get("secret") || "");
  const params = validateParameters({
    algorithm: uri.searchParams.get("algorithm") ?? "SHA1",
    digits: uri.searchParams.get("digits") ?? 6,
    period: uri.searchParams.get("period") ?? 30,
  });
  let label;
  try {
    label = decodeURIComponent(uri.pathname.slice(1));
  } catch {
    throw new Error("The account name in the link is invalid.");
  }
  const issuer = uri.searchParams.get("issuer")?.trim();
  const suggestedName =
    issuer && !label.toLowerCase().startsWith(issuer.toLowerCase())
      ? `${issuer}${label ? ` · ${label}` : ""}`
      : label || issuer || "";
  return { secret, ...params, suggestedName };
}

export async function createGenerator(account) {
  const { algorithm, digits, period } = validateParameters(account);
  const hash = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" }[
    algorithm
  ];
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase32(account.secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return async function generate(timestamp = Date.now()) {
    if (!Number.isFinite(timestamp) || timestamp < 0)
      throw new Error("Invalid timestamp.");
    const counter = BigInt(Math.floor(timestamp / 1000 / period));
    const message = new Uint8Array(8);
    new DataView(message.buffer).setBigUint64(0, counter);
    const digest = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, message),
    );
    const offset = digest.at(-1) & 15;
    const binary =
      ((digest[offset] & 127) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3];
    return String(binary % 10 ** digits).padStart(digits, "0");
  };
}
