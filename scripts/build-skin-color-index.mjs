#!/usr/bin/env node
/**
 * Build image-derived color histograms for n1ssan's src/skins.json.
 * Run from the project root after: npm install sharp
 * Command: node scripts/build-skin-color-index.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const skinsPath = path.join(root, "src", "skins.json");
const outputPath = path.join(root, "src", "skinColorIndex.json");
const skins = JSON.parse(await fs.readFile(skinsPath, "utf8"));
if (!Array.isArray(skins))
  throw new Error("Expected src/skins.json to contain an array of skins.");

const isAgent = (skin) =>
  /agent/i.test(String(skin.type || "")) ||
  /agent/i.test(String(skin.weapon || ""));
const candidates = skins.filter(
  (skin) => !isAgent(skin) && skin.image && /^https?:\/\//i.test(skin.image),
);
const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  totalCandidates: candidates.length,
  analyzed: 0,
  failed: 0,
  colors: {},
};
const concurrency = 5;
let cursor = 0,
  completed = 0;

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (delta) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: (h + 360) % 360, s, l };
}
async function analyze(skin) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(skin.image, {
        headers: { "user-agent": "n1ssan-skin-color-index/1.0" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      const { data, info } = await sharp(imageBuffer, { failOn: "none" })
        .rotate()
        .resize(48, 48, { fit: "inside", withoutEnlargement: false })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const hue = Array(24).fill(0),
        neutral = Array(3).fill(0);
      let total = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        const alpha = data[i + 3];
        if (alpha < 48) continue;
        const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
        if (s < 0.2) neutral[l < 0.22 ? 0 : l > 0.78 ? 2 : 1]++;
        else hue[Math.floor(h / 15) % 24]++;
        total++;
      }
      if (!total) throw new Error("Image contains no visible pixels");
      for (let i = 0; i < hue.length; i++) hue[i] /= total;
      for (let i = 0; i < neutral.length; i++) neutral[i] /= total;
      return { id: String(skin.id), histogram: { hue, neutral } };
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
    }
  }
  throw lastError || new Error("Unknown image processing error");
}
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= candidates.length) return;
    const skin = candidates[index];
    try {
      const result = await analyze(skin);
      output.colors[result.id] = result.histogram;
      output.analyzed++;
    } catch (error) {
      output.failed++;
      console.warn(
        `Failed: ${skin.weapon || "Unknown"} | ${skin.name || skin.id}: ${error.message}`,
      );
    }
    completed++;
    if (completed % 50 === 0 || completed === candidates.length) {
      console.log(
        `Processed ${completed}/${candidates.length} | indexed ${output.analyzed} | failed ${output.failed}`,
      );
      // Save progress after each batch, so an interrupted run still leaves a usable partial index.
      await fs.writeFile(outputPath, JSON.stringify(output));
    }
  }
}
console.log(
  `Analyzing ${candidates.length} non-agent skin images. This may take a few minutes...`,
);
await Promise.all(Array.from({ length: concurrency }, worker));
await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
console.log(
  `\nDone. Indexed ${output.analyzed}/${candidates.length} images; ${output.failed} failed.`,
);
console.log(`Output: ${path.relative(root, outputPath)}`);
if (output.analyzed === 0) process.exitCode = 1;
