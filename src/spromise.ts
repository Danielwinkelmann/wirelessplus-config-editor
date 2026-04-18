// SPROMISE trail camera config format — encode / decode / field map.
// Reverse-engineered from WirelessPlus 0.5 (SPROMISE, 2018).

export const SIZE_BIN = 868;    // MMSCFG.BIN — plain, no checksum
export const SIZE_CFG = 2048;   // wireless.cfg — additive cipher + byte checksum
export const PAT: readonly number[] = [0x38, 0x33, 0x34, 0x31];

export type FileFormat = "bin" | "cfg";

// --- Cipher (only applied to wireless.cfg) -------------------------------
// encoded[i] = (raw[i] + i + PAT[i & 3]) & 0xFF
// checksum   = (sum(encoded[0 .. size-2]) + 5) & 0xFF
//              stored at enc[size-2] = cs, enc[size-1] = ~cs

export function cfgDecode(enc: Uint8Array): Uint8Array {
  const raw = new Uint8Array(enc.length);
  for (let i = 0; i < enc.length; i++) {
    raw[i] = (enc[i] - i - PAT[i & 3]) & 0xFF;
  }
  return raw;
}

export function cfgEncode(raw: Uint8Array): Uint8Array {
  const enc = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    enc[i] = (raw[i] + i + PAT[i & 3]) & 0xFF;
  }
  let s = 0;
  for (let i = 0; i < SIZE_CFG - 2; i++) s = (s + enc[i]) & 0xFF;
  const cs = (s + 5) & 0xFF;
  enc[SIZE_CFG - 2] = cs;
  enc[SIZE_CFG - 1] = (~cs) & 0xFF;
  return enc;
}

export function cfgVerifyChecksum(enc: Uint8Array): boolean {
  if (enc.length !== SIZE_CFG) return false;
  let s = 0;
  for (let i = 0; i < SIZE_CFG - 2; i++) s = (s + enc[i]) & 0xFF;
  const cs = (s + 5) & 0xFF;
  return enc[SIZE_CFG - 2] === cs && enc[SIZE_CFG - 1] === ((~cs) & 0xFF);
}

export function detectFormat(buf: Uint8Array): FileFormat {
  return buf.length === SIZE_CFG ? "cfg" : "bin";
}

// --- I/O helpers ---------------------------------------------------------

export function toPlaintext(buf: Uint8Array): Uint8Array {
  return detectFormat(buf) === "cfg" ? cfgDecode(buf) : new Uint8Array(buf);
}

export function fromPlaintext(raw: Uint8Array, fmt: FileFormat): Uint8Array {
  return fmt === "cfg" ? cfgEncode(raw) : new Uint8Array(raw);
}

// --- Field map -----------------------------------------------------------

export type FieldKind = "str" | "byte" | "bool" | "u16le";
export type Confidence = "verified" | "inferred" | "guess";

export interface Field {
  id: string;
  label: string;
  group: string;
  off: number;
  len: number;
  kind: FieldKind;
  confidence: Confidence;
  note?: string;
}

// Offsets verified via 4 reference BINs + disassembly of WirelessPlus 0.5:
//   email save handler  @ VA 0x40131F — buf base 0x416588
//   operator params fn  @ VA 0x405A27
export const FIELDS: readonly Field[] = [
  // --- Header / Modes ---------------------------------------------------
  { id: "hdr_version",   label: "Version / Magic", group: "header", off: 0x00, len: 1, kind: "byte",  confidence: "inferred", note: "constant 0x02 — set automatically" },
  { id: "hdr_flag_02",   label: "Flag @ 0x02",     group: "header", off: 0x02, len: 1, kind: "byte",  confidence: "inferred", note: "correlates with email recipient active" },
  { id: "hdr_flag_03",   label: "Flag @ 0x03",     group: "header", off: 0x03, len: 1, kind: "byte",  confidence: "inferred" },
  { id: "hdr_hour",      label: "Daily Report Std",group: "header", off: 0x05, len: 1, kind: "byte",  confidence: "verified", note: "0..23" },
  { id: "hdr_min",       label: "Daily Report Min",group: "header", off: 0x06, len: 1, kind: "byte",  confidence: "verified", note: "0..59" },
  { id: "hdr_flag_08",   label: "Flag @ 0x08",     group: "header", off: 0x08, len: 1, kind: "byte",  confidence: "inferred", note: "correlates with APN set" },
  { id: "hdr_flag_09",   label: "Flag @ 0x09",     group: "header", off: 0x09, len: 1, kind: "byte",  confidence: "inferred" },
  { id: "hdr_u16_0a",    label: "u16 @ 0x0A",      group: "header", off: 0x0A, len: 2, kind: "u16le", confidence: "guess",    note: "Max Num? (2000 / 100 observed)" },
  { id: "hdr_byte_0c",   label: "Byte @ 0x0C",     group: "header", off: 0x0C, len: 1, kind: "byte",  confidence: "inferred", note: "always 0x01" },
  { id: "ssl",           label: "SSL",             group: "email",  off: 0x0F, len: 1, kind: "bool",  confidence: "verified", note: "from Email dialog BM_GETCHECK" },

  // --- Email recipients (guessed layout: 4 × 60 B starting 0x064) -------
  { id: "email_to_1", label: "Email 1", group: "recipients_email", off: 0x064, len: 60, kind: "str", confidence: "verified", note: "verified with juu354@mh-cam.de" },
  { id: "email_to_2", label: "Email 2", group: "recipients_email", off: 0x0A0, len: 60, kind: "str", confidence: "guess" },
  { id: "email_to_3", label: "Email 3", group: "recipients_email", off: 0x0DC, len: 60, kind: "str", confidence: "guess" },
  { id: "email_to_4", label: "Email 4", group: "recipients_email", off: 0x118, len: 60, kind: "str", confidence: "guess" },

  // --- Phone recipients (unknown — no reference data) -------------------
  { id: "phone_1", label: "Phone 1", group: "recipients_phone", off: 0x014, len: 20, kind: "str", confidence: "guess", note: "no reference — offsets unverified" },
  { id: "phone_2", label: "Phone 2", group: "recipients_phone", off: 0x028, len: 20, kind: "str", confidence: "guess" },
  { id: "phone_3", label: "Phone 3", group: "recipients_phone", off: 0x03C, len: 20, kind: "str", confidence: "guess" },
  { id: "phone_4", label: "Phone 4", group: "recipients_phone", off: 0x050, len: 20, kind: "str", confidence: "guess" },

  // --- Email / SMTP settings (all verified via disassembly) -------------
  { id: "smtp_account",  label: "Account (From)",  group: "email", off: 0x154, len: 60, kind: "str", confidence: "verified" },
  { id: "smtp_password", label: "Passwort",        group: "email", off: 0x190, len: 40, kind: "str", confidence: "verified" },
  { id: "smtp_server",   label: "SMTP Server",     group: "email", off: 0x1B8, len: 40, kind: "str", confidence: "verified" },
  { id: "smtp_port",     label: "SMTP Port",       group: "email", off: 0x1E0, len: 6,  kind: "str", confidence: "verified" },

  // --- Operator parameters — MMS section (from F_405A27) ---------------
  { id: "mms_apn",       label: "APN",             group: "mms", off: 0x1E6, len: 40, kind: "str", confidence: "inferred" },
  { id: "mms_user",      label: "Username",        group: "mms", off: 0x20E, len: 40, kind: "str", confidence: "inferred" },
  { id: "mms_password",  label: "Passwort",        group: "mms", off: 0x236, len: 40, kind: "str", confidence: "inferred" },
  { id: "mms_url",       label: "URL (MMSC)",      group: "mms", off: 0x25E, len: 80, kind: "str", confidence: "inferred" },
  { id: "mms_gateway",   label: "Gateway (Proxy)", group: "mms", off: 0x2AE, len: 40, kind: "str", confidence: "inferred" },
  { id: "mms_port",      label: "Port",            group: "mms", off: 0x2D6, len: 6,  kind: "str", confidence: "inferred" },

  // --- Operator parameters — Internet section --------------------------
  { id: "net_apn",       label: "APN",             group: "internet", off: 0x2DC, len: 40, kind: "str", confidence: "verified", note: "verified with mhsim" },
  { id: "net_user",      label: "Username",        group: "internet", off: 0x304, len: 40, kind: "str", confidence: "guess" },
  { id: "net_password",  label: "Passwort",        group: "internet", off: 0x32C, len: 40, kind: "str", confidence: "guess" },
];

// --- Read / write primitives --------------------------------------------

export function readField(buf: Uint8Array, f: Field): string | number | boolean {
  switch (f.kind) {
    case "str":   return readString(buf, f.off, f.len);
    case "byte":  return buf[f.off];
    case "bool":  return buf[f.off] !== 0;
    case "u16le": return buf[f.off] | (buf[f.off + 1] << 8);
  }
}

export function writeField(buf: Uint8Array, f: Field, value: string | number | boolean): void {
  switch (f.kind) {
    case "str":
      writeString(buf, f.off, f.len, String(value ?? ""));
      return;
    case "byte": {
      const n = typeof value === "number" ? value : parseInt(String(value), 10);
      if (!Number.isNaN(n)) buf[f.off] = n & 0xFF;
      return;
    }
    case "bool":
      buf[f.off] = value ? 1 : 0;
      return;
    case "u16le": {
      const n = typeof value === "number" ? value : parseInt(String(value), 10);
      if (!Number.isNaN(n)) {
        buf[f.off] = n & 0xFF;
        buf[f.off + 1] = (n >> 8) & 0xFF;
      }
      return;
    }
  }
}

function readString(buf: Uint8Array, off: number, len: number): string {
  let end = off;
  while (end < off + len && end < buf.length && buf[end] !== 0) end++;
  return new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(off, end));
}

function writeString(buf: Uint8Array, off: number, len: number, value: string): void {
  for (let i = 0; i < len && off + i < buf.length; i++) buf[off + i] = 0;
  const bytes = new TextEncoder().encode(value);
  const n = Math.min(bytes.length, len - 1);
  for (let i = 0; i < n; i++) buf[off + i] = bytes[i];
}

// --- Template buffers ----------------------------------------------------

export function newBlank(fmt: FileFormat): Uint8Array {
  const size = fmt === "cfg" ? SIZE_CFG : SIZE_BIN;
  const buf = new Uint8Array(size);
  buf[0x00] = 0x02; // version
  buf[0x05] = 18;   // daily report hour
  buf[0x06] = 0;    // daily report minute
  buf[0x0C] = 0x01; // flag always 1
  return buf;
}
