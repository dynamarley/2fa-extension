import test from "node:test";
import assert from "node:assert/strict";
import {
  createGenerator,
  decodeBase32,
  normalizeSecret,
  parseAccountInput,
  validateParameters,
} from "../src/totp.js";

function encodeBase32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of new TextEncoder().encode(text)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

const seeds = {
  SHA1: "12345678901234567890",
  SHA256: "12345678901234567890123456789012",
  SHA512: "1234567890123456789012345678901234567890123456789012345678901234",
};
const vectors = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

for (const [algorithm, index] of [
  ["SHA1", 1],
  ["SHA256", 2],
  ["SHA512", 3],
]) {
  test(`RFC 6238: ${algorithm}, all six official timestamps`, async () => {
    const generate = await createGenerator({
      secret: encodeBase32(seeds[algorithm]),
      algorithm,
      digits: 8,
    });
    for (const vector of vectors)
      assert.equal(await generate(vector[0] * 1000), vector[index]);
  });
}

test("six-digit codes preserve leading zeroes and change at the period boundary", async () => {
  const generate = await createGenerator({ secret: encodeBase32(seeds.SHA1) });
  assert.equal(await generate(59000), "287082");
  assert.equal(await generate(29999), "755224");
  assert.equal(await generate(30000), "287082");
  assert.equal(await generate(1111111109000), "081804");
});

test("custom period uses the correct time counter", async () => {
  const generate = await createGenerator({
    secret: encodeBase32(seeds.SHA1),
    period: 60,
  });
  assert.equal(await generate(59999), "755224");
  assert.equal(await generate(60000), "287082");
  await assert.rejects(generate(-1), /timestamp/);
});

test("Base32 accepts lowercase, spaces, and valid padding", () => {
  assert.equal(normalizeSecret("jbsw y3dp ehpk 3pxp"), "JBSWY3DPEHPK3PXP");
  const encoded = encodeBase32(seeds.SHA256);
  assert.equal(normalizeSecret(`${encoded}====`), encoded);
  assert.equal(new TextDecoder().decode(decodeBase32(encoded)), seeds.SHA256);
});

test("malformed, truncated, short, and noncanonical Base32 inputs are rejected", () => {
  for (const secret of [
    "",
    "ABC",
    "0123456789012345",
    "AAAAAAAAAAAAAAAA!",
    "AAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAB",
    "AAAAAAAAAAAAAAAA=",
    "AAAAAAAAAAAAAAAA==AAAA",
  ]) {
    assert.throws(() => normalizeSecret(secret));
  }
});

test("raw input uses standard settings and retains existing account settings during editing", () => {
  assert.deepEqual(parseAccountInput("JBSWY3DPEHPK3PXP"), {
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    suggestedName: "",
  });
  const parsed = parseAccountInput("JBSWY3DPEHPK3PXP", {
    algorithm: "SHA256",
    digits: 8,
    period: 60,
  });
  assert.equal(parsed.algorithm, "SHA256");
  assert.equal(parsed.digits, 8);
  assert.equal(parsed.period, 60);
});

test("otpauth URI reads issuer, encoded account name and algorithm parameters", () => {
  const parsed = parseAccountInput(
    "otpauth://totp/alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=60",
  );
  assert.deepEqual(parsed, {
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA256",
    digits: 8,
    period: 60,
    suggestedName: "Example · alice@example.com",
  });
  assert.equal(
    parseAccountInput(
      "otpauth://totp/Example%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=Example",
    ).suggestedName,
    "Example:alice",
  );
});

test("unsafe or unsupported URI parameters are rejected", () => {
  for (const uri of [
    "otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP",
    "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=MD5",
    "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7",
    "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=0",
    "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=301",
    "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&period=1.5",
    "otpauth://totp/Test",
    "otpauth://totp/%ZZ?secret=JBSWY3DPEHPK3PXP",
  ])
    assert.throws(() => parseAccountInput(uri));
  assert.throws(() => validateParameters({ algorithm: "MD5" }));
});

test("manifest stays offline and references existing packaged files", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions, ["storage", "clipboardWrite"]);
  assert.match(
    manifest.content_security_policy.extension_pages,
    /connect-src 'none'/,
  );
  for (const file of [
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
  ]) {
    await access(new URL(`../${file}`, import.meta.url));
  }
});
