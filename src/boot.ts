// Futuristic boot overlay: typewriter BIOS lines → glyph-scramble banner →
// progress bar → SYSTEM ONLINE → fade out.

import { animate, stagger } from "animejs";
import { FIELDS } from "./spromise";

const GLYPHS = "!@#$%&*+=?<>[]{}/\\|~01";
const BANNER = [
  " ███████ ██████  ██████   ██████  ███    ███ ██ ███████ ███████ ",
  " ██      ██   ██ ██   ██ ██    ██ ████  ████ ██ ██      ██      ",
  " ███████ ██████  ██████  ██    ██ ██ ████ ██ ██ ███████ █████   ",
  "      ██ ██      ██   ██ ██    ██ ██  ██  ██ ██      ██ ██      ",
  " ███████ ██      ██   ██  ██████  ██      ██ ██ ███████ ███████ ",
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (s: string) => s[Math.floor(Math.random() * s.length)];

function scramble(target: string, steps = 16): string[] {
  const frames: string[] = [];
  for (let i = 0; i < steps; i++) {
    let out = "";
    const progress = i / (steps - 1);
    for (const ch of target) {
      if (ch === " ") { out += " "; continue; }
      out += Math.random() < progress ? ch : rand(GLYPHS);
    }
    frames.push(out);
  }
  frames.push(target);
  return frames;
}

export async function runBoot(root: HTMLElement): Promise<void> {
  const overlay = document.createElement("div");
  overlay.className = "boot-overlay";
  overlay.innerHTML = `
    <div class="boot-inner">
      <div class="boot-log" id="bootLog"></div>
      <pre class="boot-banner" id="bootBanner"></pre>
      <div class="boot-status" id="bootStatus"></div>
      <div class="boot-bar"><div class="boot-bar-fill" id="bootBarFill"></div></div>
      <div class="boot-online" id="bootOnline">[ SYSTEM ONLINE ]</div>
    </div>
    <div class="boot-scanlines"></div>
    <div class="boot-vignette"></div>
  `;
  document.body.appendChild(overlay);

  const logEl      = overlay.querySelector<HTMLElement>("#bootLog")!;
  const bannerEl   = overlay.querySelector<HTMLElement>("#bootBanner")!;
  const statusEl   = overlay.querySelector<HTMLElement>("#bootStatus")!;
  const barFillEl  = overlay.querySelector<HTMLElement>("#bootBarFill")!;
  const onlineEl   = overlay.querySelector<HTMLElement>("#bootOnline")!;

  // --- Type out boot lines ----------------------------------------------
  const verifiedCount = FIELDS.filter(f => f.confidence === "verified").length;
  const inferredCount = FIELDS.filter(f => f.confidence === "inferred").length;
  const guessCount    = FIELDS.filter(f => f.confidence === "guess").length;

  const lines: Array<{ text: string; cls?: string; delay?: number }> = [
    { text: "> spromise config editor · boot sequence", cls: "dim" },
    { text: "> loading wirelessplus 0.5 schema ........ [ ok ]" },
    { text: `> parsing field map .................. [ ${FIELDS.length} entries ]` },
    { text: "> establishing cipher · add mod 256 ..... [ ok ]" },
    { text: "> checksum · sum + 5 · complement ........ [ ok ]" },
    { text: `> verified .............................. [ ${String(verifiedCount).padStart(2)} ]`, cls: "ok" },
    { text: `> inferred .............................. [ ${String(inferredCount).padStart(2)} ]`, cls: "warn" },
    { text: `> guess ................................. [ ${String(guessCount).padStart(2)} ]`, cls: "err" },
    { text: "> decryption subsystem .................. ready" },
    { text: "> ui subsystem .......................... ready" },
  ];

  for (const line of lines) {
    const row = document.createElement("div");
    row.className = `boot-line ${line.cls ?? ""}`;
    logEl.appendChild(row);
    await typewrite(row, line.text, 4 + Math.random() * 6);
    await sleep(line.delay ?? 40);
  }

  // --- Banner glyph scramble --------------------------------------------
  await sleep(200);
  const scrambleSteps = 18;
  const bannerFrames: string[][] = BANNER.map(l => scramble(l, scrambleSteps));
  for (let step = 0; step < scrambleSteps + 1; step++) {
    bannerEl.textContent = bannerFrames.map(f => f[step]).join("\n");
    await sleep(45);
  }
  bannerEl.classList.add("locked");
  await sleep(400);

  // --- Progress bar -----------------------------------------------------
  statusEl.textContent = "initializing ui · decoder · renderer";
  await animate(barFillEl, { width: ["0%", "100%"], ease: "outQuad", duration: 900 }).then(() => {});

  // --- SYSTEM ONLINE pulse ---------------------------------------------
  onlineEl.classList.add("show");
  await sleep(800);

  // --- Fade overlay, reveal UI -----------------------------------------
  overlay.classList.add("fade");
  await sleep(450);
  overlay.remove();

  // Stagger cards in
  const cards = root.querySelectorAll(".card");
  if (cards.length) {
    animate(cards, {
      opacity: [0, 1],
      translateY: [12, 0],
      delay: stagger(60),
      duration: 420,
      ease: "outCubic",
    });
  }
}

async function typewrite(target: HTMLElement, text: string, speed: number): Promise<void> {
  for (let i = 0; i <= text.length; i++) {
    target.textContent = text.slice(0, i);
    await sleep(speed);
  }
}
