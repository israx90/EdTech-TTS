/**
 * Generate Kokoro voice demo files.
 * Run: node scripts/generate-kokoro-demos.mjs
 */

import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '..', 'public', 'demos');

const DEMO_TEXT = 'Hello, this is a demonstration of my voice. I can read entire documents with clarity and naturalness.';

// Kokoro voices — the model is English-focused with these top-quality voices
const KOKORO_VOICES = [
  'af_heart',   // Female - Heart (top rated)
  'af_bella',   // Female - Bella
  'af_sarah',   // Female - Sarah
  'am_michael', // Male - Michael
  'am_fenrir',  // Male - Fenrir
  'bm_george',  // Male - George (British)
];

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('🧠 Generating Kokoro Neural demos...');
  
  const { KokoroTTS } = await import('kokoro-js');
  console.log('   ├─ Loading model...');
  
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'auto',
  });

  for (const voice of KOKORO_VOICES) {
    try {
      process.stdout.write(`   ├─ ${voice}... `);
      const audio = await tts.generate(DEMO_TEXT, { voice });
      const outPath = join(OUTPUT_DIR, `kokoro_${voice}.wav`);
      await audio.save(outPath);
      console.log('✅');
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }
  
  console.log('\n✅ Kokoro demos complete!');
}

main().catch(console.error);
