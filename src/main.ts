import "./style.css";
import flatpickr from "flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import { runBoot } from "./boot";
import {
  cfgDecode, cfgEncode, cfgVerifyChecksum,
  detectFormat, newBlank,
  FIELDS, readField, writeField,
  type Field, type FileFormat,
} from "./spromise";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMMON_SMTP_PORTS: Array<{ value: string; label: string }> = [
  { value: "25",   label: "25"   },
  { value: "465",  label: "465 / SSL"  },
  { value: "587",  label: "587 / TLS"  },
  { value: "2525", label: "2525" },
];

// ---------- State ----------
let rawBuf: Uint8Array | null = null;
let originalRaw: Uint8Array | null = null;
let fileFormat: FileFormat = "bin";
let fileName = "MMSCFG.BIN";
let showAll = false;

const isVisible = (f: Field) => showAll || f.confidence === "verified";

// ---------- DOM helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null) continue;
    e.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return e;
}

const confidenceBadge = (c: Field["confidence"]) =>
  el("span", { class: `badge ${c}` }, c);

// ---------- Group metadata ----------
interface GroupDef { id: string; title: string; range: string; match: (f: Field) => boolean }
const GROUPS: GroupDef[] = [
  { id: "mode",     title: "Modi & Zeit",          range: "@0x000—0x00F",
    match: f => f.group === "header" || f.id === "ssl" && false },
  { id: "phones",   title: "Recipients · Phone",   range: "@0x014—0x063",
    match: f => f.group === "recipients_phone" },
  { id: "emails",   title: "Recipients · Email",   range: "@0x064—0x153",
    match: f => f.group === "recipients_email" },
  { id: "email",    title: "Email Setting (SMTP)", range: "@0x154—0x1E5 · SSL @0x0F",
    match: f => f.group === "email" || f.id === "ssl" },
  { id: "mms",      title: "Operator · MMS",       range: "@0x1E6—0x2DB",
    match: f => f.group === "mms" },
  { id: "internet", title: "Operator · Internet",  range: "@0x2DC—0x353",
    match: f => f.group === "internet" },
];

// ---------- Rendering ----------
function renderApp(): void {
  const app = $("app");
  if (!app) return;
  app.replaceChildren();
  for (const g of GROUPS) {
    const fields = FIELDS.filter(f => g.match(f) && isVisible(f));
    if (!fields.length) continue;
    app.append(renderCard(g, fields));
  }
  // After re-rendering, push current buffer values back into the new controls.
  initTimePicker();
  loadFieldsFromBuf();
}

function renderCard(g: GroupDef, fields: readonly Field[]): HTMLElement {
  const body = el("div", { class: "body" });
  if (g.id === "mode")       body.append(...renderModeRows(fields));
  else if (g.id === "email") body.append(...renderEmailRows(fields));
  else                       body.append(...fields.map(renderGenericRow));

  return el("section", { class: "card" },
    el("header", { class: "card-hd" },
      el("h2", {}, g.title),
      el("span", { class: "range" }, g.range),
    ),
    body,
  );
}

function renderModeRows(fields: readonly Field[]): Node[] {
  const rows: Node[] = [];

  const hourF = fields.find(f => f.id === "hdr_hour");
  const minF  = fields.find(f => f.id === "hdr_min");
  if (hourF && minF) {
    const picker = el("input", {
      type: "text", class: "time-picker",
      "data-field-hour": "hdr_hour", "data-field-min": "hdr_min",
      placeholder: "hh:mm",
    });
    rows.push(el("div", { class: "row" },
      el("label", {}, "daily report time"),
      picker,
      el("small", {}, "hh:mm · @0x05/06"),
    ));
  }

  for (const id of ["hdr_flag_02", "hdr_flag_03", "hdr_flag_08", "hdr_flag_09"]) {
    const f = fields.find(x => x.id === id);
    if (!f) continue;
    rows.push(rowFor(f, toggleControl(f)));
  }

  const u16 = fields.find(f => f.id === "hdr_u16_0a");
  if (u16) rows.push(rowFor(u16, el("input", { type: "number", min: 0, max: 65535, "data-field": u16.id })));

  for (const id of ["hdr_version", "hdr_byte_0c"]) {
    const f = fields.find(x => x.id === id);
    if (!f) continue;
    rows.push(rowFor(f, el("input", { type: "number", min: 0, max: 255, "data-field": f.id, style: "max-width:100px" })));
  }
  return rows;
}

function renderEmailRows(fields: readonly Field[]): Node[] {
  const order = ["smtp_account", "smtp_password", "smtp_server", "smtp_port", "ssl"];
  const rows: Node[] = [];
  for (const id of order) {
    const f = fields.find(x => x.id === id);
    if (!f) continue;
    rows.push(renderGenericRow(f));
  }
  rows.push(el("div", { class: "hint" },
    "Der Email-Dialog hat kein Username-Feld — Account-Email dient gleichzeitig als SMTP-Login."));
  return rows;
}

function rowFor(f: Field, control: Node): HTMLElement {
  const off = `0x${f.off.toString(16).padStart(2, "0").toUpperCase()}`;
  return el("div", { class: "row" },
    el("label", {}, f.label.toLowerCase()),
    control,
    el("small", {}, `${off} · ${f.note ?? ""} `, confidenceBadge(f.confidence)),
  );
}

function renderGenericRow(f: Field): HTMLElement {
  let control: Node;
  if (f.id === "smtp_port") {
    control = portPickerControl(f);
  } else if (f.kind === "str") {
    const attrs: Attrs = { type: "text", "data-field": f.id, maxlength: f.len - 1 };
    if (f.id === "smtp_account" || f.id.startsWith("email_to_")) {
      attrs["data-validate"] = "email";
      attrs.placeholder = "name@example.com";
    }
    control = el("input", attrs);
  } else if (f.kind === "bool") {
    control = toggleControl(f);
  } else if (f.kind === "byte") {
    control = el("input", { type: "number", min: 0, max: 255, "data-field": f.id });
  } else {
    control = el("input", { type: "number", min: 0, max: 65535, "data-field": f.id });
  }
  const off = `0x${f.off.toString(16).padStart(3, "0").toUpperCase()}`;
  return el("div", { class: "row" },
    el("label", {}, f.label.toLowerCase()),
    control,
    el("small", {}, `${off} · ${f.len}b `, confidenceBadge(f.confidence)),
  );
}

function portPickerControl(f: Field): HTMLElement {
  const group = el("div", { class: "segmented port-presets" });
  for (const p of COMMON_SMTP_PORTS) {
    const b = el("button", { type: "button", "data-port": p.value }, p.label);
    group.append(b);
  }
  const input = el("input", {
    type: "text", "data-field": f.id, maxlength: f.len - 1,
    inputmode: "numeric", pattern: "[0-9]*", class: "port-input",
  });
  group.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-port]") as HTMLButtonElement | null;
    if (!btn) return;
    (input as HTMLInputElement).value = btn.dataset.port ?? "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    updatePortSelection(group, input as HTMLInputElement);
  });
  (input as HTMLInputElement).addEventListener("input", () => updatePortSelection(group, input as HTMLInputElement));
  return el("div", { class: "port-wrap" }, input, group);
}
function updatePortSelection(group: HTMLElement, input: HTMLInputElement): void {
  for (const b of group.querySelectorAll<HTMLButtonElement>("[data-port]")) {
    b.classList.toggle("active", b.dataset.port === input.value.trim());
  }
}

function toggleControl(f: Field): HTMLElement {
  return el("label", { class: "toggle" },
    el("input", { type: "checkbox", "data-field": f.id }),
    el("span", { class: "track" }),
  );
}

// ---------- Flatpickr + validation plumbing ----------
function initTimePicker(): void {
  const picker = document.querySelector<HTMLInputElement>(".time-picker");
  if (!picker) return;
  const hour = rawBuf ? rawBuf[0x05] & 0xFF : 18;
  const min  = rawBuf ? rawBuf[0x06] & 0xFF : 0;
  flatpickr(picker, {
    enableTime: true, noCalendar: true,
    dateFormat: "H:i", time_24hr: true, minuteIncrement: 1,
    defaultDate: `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
    onChange: (_dates, str) => {
      const [hh = "0", mm = "0"] = str.split(":");
      if (!rawBuf) return;
      rawBuf[0x05] = parseInt(hh, 10) & 0xFF;
      rawBuf[0x06] = parseInt(mm, 10) & 0xFF;
      renderHex();
    },
  });
}

function validateEmails(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-validate=email]")) {
    const v = input.value.trim();
    const ok = v === "" || EMAIL_RE.test(v);
    input.classList.toggle("invalid", !ok);
  }
}

// ---------- Read / write DOM <-> buffer ----------
function loadFieldsFromBuf(): void {
  if (!rawBuf) return;
  for (const f of FIELDS) {
    if (f.id === "hdr_hour" || f.id === "hdr_min") continue;
    const node = document.querySelector<HTMLInputElement>(`[data-field="${f.id}"]`);
    if (!node) continue;
    const v = readField(rawBuf, f);
    if (f.kind === "bool") node.checked = !!v;
    else node.value = String(v ?? "");
  }
  // Time picker value is set at init (defaultDate). For re-renders we update it:
  const picker = document.querySelector<HTMLInputElement & { _flatpickr?: flatpickr.Instance }>(".time-picker");
  if (picker?._flatpickr) {
    const hh = String(rawBuf[0x05]).padStart(2, "0");
    const mm = String(rawBuf[0x06]).padStart(2, "0");
    picker._flatpickr.setDate(`${hh}:${mm}`, false);
  }
  // Port preset highlight
  const portInput = document.querySelector<HTMLInputElement>("[data-field='smtp_port']");
  const portGroup = document.querySelector<HTMLElement>(".port-presets");
  if (portInput && portGroup) updatePortSelection(portGroup, portInput);
  validateEmails();
}
function writeFieldsToBuf(): void {
  if (!rawBuf) return;
  for (const f of FIELDS) {
    if (f.id === "hdr_hour" || f.id === "hdr_min") continue;
    const node = document.querySelector<HTMLInputElement>(`[data-field="${f.id}"]`);
    if (!node) continue;
    const v = f.kind === "bool" ? node.checked : node.value;
    writeField(rawBuf, f, v);
  }
  validateEmails();
}

// ---------- Hex view ----------
function renderHex(): void {
  if (!rawBuf) return;
  const hv = $("hexView");
  const range = $("hex-range");
  if (!hv) return;
  if (range) range.textContent = `0x000 .. 0x${(rawBuf.length - 1).toString(16).toUpperCase().padStart(3, "0")}`;
  const lines: string[] = [];
  const escMap: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;" };
  const esc = (ch: string) => escMap[ch] ?? ch;
  for (let row = 0; row < rawBuf.length; row += 16) {
    let hex = "";
    let ascii = "";
    for (let c = 0; c < 16; c++) {
      const i = row + c;
      if (i >= rawBuf.length) { hex += "   "; continue; }
      const b = rawBuf[i];
      const diff = originalRaw && originalRaw[i] !== b;
      const h = b.toString(16).padStart(2, "0");
      const cls = diff ? "diff" : (b === 0 ? "" : "nz");
      hex += cls ? `<span class="${cls}">${h}</span> ` : `${h} `;
      ascii += (b >= 0x20 && b < 0x7F) ? esc(String.fromCharCode(b)) : ".";
    }
    const off = row.toString(16).padStart(4, "0");
    lines.push(`<span class="off">${off}</span>  ${hex} <span class="asc">${ascii}</span>`);
  }
  hv.innerHTML = lines.join("\n");
}

// ---------- Status / info ----------
function showStatus(msg: string, kind: "ok" | "warn" | "err" = "ok"): void {
  const s = $("status");
  if (!s) return;
  s.className = "status " + kind;
  s.textContent = msg;
}
function updateInfo(): void {
  const info = $("info");
  if (!info) return;
  const fmt = fileFormat === "cfg" ? "enc" : "plain";
  info.textContent = `${fileName} · ${fmt} · ${rawBuf?.length ?? 0}B`;
}

// ---------- File ops ----------
function loadBuf(buf: Uint8Array, name: string, statusMsg?: string): void {
  fileName = name;
  fileFormat = detectFormat(buf);
  if (fileFormat === "cfg") {
    const ok = cfgVerifyChecksum(buf);
    rawBuf = cfgDecode(buf);
    showStatus(statusMsg ?? `loaded ${name} · wireless.cfg · checksum ${ok ? "OK" : "INVALID"}`, ok ? "ok" : "warn");
  } else {
    rawBuf = new Uint8Array(buf);
    showStatus(statusMsg ?? `loaded ${name} · MMSCFG.BIN · plain (${buf.length} B)`);
  }
  originalRaw = new Uint8Array(rawBuf);
  const saveBtn = $<HTMLButtonElement>("saveBtn");
  if (saveBtn) saveBtn.disabled = false;
  loadFieldsFromBuf();
  renderHex();
  updateInfo();
}

// ---------- Event wiring ----------
$<HTMLInputElement>("fileInput")?.addEventListener("change", async (e) => {
  const target = e.target as HTMLInputElement;
  const f = target.files?.[0];
  if (!f) return;
  const buf = new Uint8Array(await f.arrayBuffer());
  loadBuf(buf, f.name);
  target.value = "";
});

$<HTMLInputElement>("showAllToggle")?.addEventListener("change", (e) => {
  showAll = (e.target as HTMLInputElement).checked;
  const raw = $("rawBytesCard");
  if (raw) raw.hidden = !showAll;
  renderApp();
});

$("newBinBtn")?.addEventListener("click", () => loadBuf(newBlank("bin"), "MMSCFG.BIN", "new blank MMSCFG.BIN"));
$("newCfgBtn")?.addEventListener("click", () => loadBuf(newBlank("cfg"), "wireless.cfg", "new blank wireless.cfg"));

$("saveBtn")?.addEventListener("click", () => {
  if (!rawBuf) return;
  writeFieldsToBuf();
  const out = fileFormat === "cfg" ? cfgEncode(rawBuf) : new Uint8Array(rawBuf);
  const blob = new Blob([out.buffer as ArrayBuffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
  showStatus(`saved ${fileName}`);
  renderHex();
});

document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (!rawBuf || !t?.dataset.field) return;
  writeFieldsToBuf();
  renderHex();
});
document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (!rawBuf || !t?.dataset.field) return;
  writeFieldsToBuf();
  renderHex();
});

// ---------- Boot ----------
const appRoot = document.body;
renderApp();
runBoot(appRoot).catch(console.error);
