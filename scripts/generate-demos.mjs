/**
 * Generate voice demo MP3 files for all TTS voices.
 * Run: node scripts/generate-demos.mjs
 * 
 * This generates pre-baked demo audio files that the web app plays
 * when users preview voices — no runtime synthesis needed.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '..', 'public', 'demos');

// Demo text for each voice
const DEMO_TEXT = 'Hola, esta es una demostración de mi voz. Puedo leer documentos completos con claridad y naturalidad.';

// Edge TTS voices to generate demos for
const EDGE_VOICES = [
  'es-MX-DaliaNeural',
  'es-MX-JorgeNeural',
  'es-AR-ElenaNeural',
  'es-AR-TomasNeural',
  'es-CO-SalomeNeural',
  'es-CO-GonzaloNeural',
  'es-CL-CatalinaNeural',
  'es-CL-LorenzoNeural',
  'es-ES-ElviraNeural',
  'es-ES-AlvaroNeural',
];

async function generateEdgeDemos() {
  console.log('🎙️  Generating Edge TTS demos...');
  const { EdgeTTS } = await import('edge-tts-universal');

  for (const voice of EDGE_VOICES) {
    try {
      const shortName = voice.split('-').slice(0, 2).join('-');
      process.stdout.write(`   ├─ ${voice} (${shortName})... `);
      
      const tts = new EdgeTTS(DEMO_TEXT, voice);
      const result = await tts.synthesize();
      const arrayBuffer = await result.audio.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      const outPath = join(OUTPUT_DIR, `edge_${voice}.mp3`);
      writeFileSync(outPath, buffer);
      console.log(`✅ ${(buffer.length / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }
}

async function generateKokoroDemos() {
  console.log('\n🧠 Generating Kokoro Neural demos...');
  
  try {
    const { KokoroTTS } = await import('kokoro-js');
    console.log('   ├─ Loading model (first run downloads ~80MB)...');
    
    const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'auto',
    });

    const KOKORO_VOICES = ['ef_dora', 'em_alex', 'em_santa'];
    
    for (const voice of KOKORO_VOICES) {
      try {
        process.stdout.write(`   ├─ ${voice}... `);
        
        const audio = await tts.generate(DEMO_TEXT, { voice });
        
        // Save as WAV
        const outPath = join(OUTPUT_DIR, `kokoro_${voice}.wav`);
        await audio.save(outPath);
        
        console.log(`✅`);
      } catch (err) {
        console.log(`❌ ${err.message}`);
      }
    }
  } catch (err) {
    console.error('   ❌ Failed to load Kokoro:', err.message);
    console.log('   ℹ️  Kokoro demos will be skipped. The app will still work without them.');
  }
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`📁 Output: ${OUTPUT_DIR}\n`);

  await generateEdgeDemos();
  await generateKokoroDemos();

  console.log('\n✅ Demo generation complete!');
  console.log('   Commit public/demos/ to your repository.');
}

main().catch(console.error);
