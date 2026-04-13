import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// CORS: allow GitHub Pages + localhost
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:3000',
    'https://israx90.github.io'
  ],
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '5mb' }));

// ═══════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════
const EN_VOICE = 'en-US-AriaNeural';

// ═══════════════════════════════════════════════
// MP3 Frame Utilities – silence trimming
// ═══════════════════════════════════════════════

/** Find the nearest MP3 frame sync (0xFF 0xE0+) from a given position */
function findFrameSync(buffer, pos, direction = 1) {
  pos = Math.max(0, Math.min(pos, buffer.length - 2));
  while (pos >= 0 && pos < buffer.length - 1) {
    if (buffer[pos] === 0xFF && (buffer[pos + 1] & 0xE0) === 0xE0) return pos;
    pos += direction;
  }
  return direction > 0 ? buffer.length : 0;
}

/**
 * Synthesize a text segment and return audio buffer + speech timing.
 * Uses Communicate API directly for WordBoundary metadata.
 */
async function synthesizeSegment(text, voice) {
  const { Communicate } = await import('edge-tts-universal');
  const com = new Communicate(text, { voice });
  const audioChunks = [];
  let firstWordOffset = null;
  let lastWordEnd = null;

  for await (const chunk of com.stream()) {
    if (chunk.type === 'audio' && chunk.data) {
      audioChunks.push(chunk.data);
    } else if (chunk.type === 'WordBoundary') {
      if (firstWordOffset === null) firstWordOffset = chunk.offset;
      lastWordEnd = chunk.offset + chunk.duration;
    }
  }

  return {
    audio: Buffer.concat(audioChunks),
    speechStart: firstWordOffset !== null ? firstWordOffset / 10_000_000 : 0,
    speechEnd: lastWordEnd !== null ? lastWordEnd / 10_000_000 : null
  };
}

/**
 * Trim silence from an MP3 buffer using speech timing info.
 * Snaps to MP3 frame boundaries so the output is always valid.
 * 
 * @param {Buffer} buffer - Raw MP3 data
 * @param {number} speechStart - When speech begins (seconds)
 * @param {number|null} speechEnd - When speech ends (seconds)
 * @param {object} flags - isFirst/isLast to preserve natural head/tail
 */
function trimAudio(buffer, speechStart, speechEnd, { isFirst = false, isLast = false } = {}) {
  const BPS = 6000; // 48kbps = 6000 bytes/sec
  let startByte = 0;
  let endByte = buffer.length;

  // Trim leading silence (except for first segment – keep natural onset)
  if (!isFirst && speechStart > 0.02) {
    startByte = Math.max(0, Math.floor((speechStart - 0.015) * BPS));
    startByte = findFrameSync(buffer, startByte, 1);
  }

  // Trim trailing silence (except for last segment – keep natural tail)
  if (!isLast && speechEnd !== null) {
    endByte = Math.min(buffer.length, Math.ceil((speechEnd + 0.025) * BPS));
    const next = findFrameSync(buffer, endByte, 1);
    endByte = next < buffer.length ? next : buffer.length;
  }

  return buffer.slice(startByte, endByte);
}

/**
 * Parse text with <swap>word</swap> markers into voice-assigned segments.
 * Spanish text uses mainVoice, English words inside <swap> use EN_VOICE.
 */
function parseSwapSegments(text, mainVoice) {
  const segments = [];
  const regex = /<swap>(.*?)<\/swap>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const prev = text.substring(lastIndex, match.index).trim();
      // Keep segment only if it has actual speakable content
      if (prev && prev.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ0-9]/g, '').length > 0) {
        segments.push({ text: prev, voice: mainVoice });
      }
    }
    segments.push({ text: match[1], voice: EN_VOICE });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex).trim();
    if (remaining && remaining.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ0-9]/g, '').length > 0) {
      segments.push({ text: remaining, voice: mainVoice });
    }
  }

  return segments;
}

// ═══════════════════════════════════════════════
// Endpoint: Microsoft Edge TTS (Azure Neural)
// ═══════════════════════════════════════════════
app.post('/api/tts', async (req, res) => {
  const { text, voice } = req.body;
  
  if (!text || !voice) {
    return res.status(400).json({ error: 'Missing text or voice' });
  }

  try {
    const hasSwapTags = /<swap>/.test(text);

    if (hasSwapTags) {
      // ═══════════════════════════════════════
      // TWO-PASS: Split by language, synth each
      // segment separately, trim silence, concat
      // ═══════════════════════════════════════
      const segments = parseSwapSegments(text, voice);
      console.log(`🔀 Two-Pass: ${segments.length} segmentos`);

      const trimmedChunks = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const { audio, speechStart, speechEnd } = await synthesizeSegment(seg.text, seg.voice);
        const trimmed = trimAudio(audio, speechStart, speechEnd, {
          isFirst: i === 0,
          isLast: i === segments.length - 1
        });
        trimmedChunks.push(trimmed);
      }

      const combined = Buffer.concat(trimmedChunks);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', combined.length);
      res.send(combined);
    } else {
      // ═══════════════════════════════════════
      // SINGLE-PASS: Standard synthesis
      // ═══════════════════════════════════════
      const { EdgeTTS } = await import('edge-tts-universal');
      const edgeTTS = new EdgeTTS(text, voice);
      const result = await edgeTTS.synthesize();
      
      const arrayBuffer = await result.audio.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', buffer.length);
      res.send(buffer);
    }
  } catch (err) {
    console.error('Edge TTS Error:', err);
    res.status(500).json({ error: err.message || 'TTS synthesis failed' });
  }
});

// ═══════════════════════════════════════════════
// Health check (for Render monitoring)
// ═══════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'edge-tts', timestamp: Date.now() });
});

// ═══════════════════════════════════════════════
// SERVE FRONTEND (Para producción local)
// ═══════════════════════════════════════════════
app.use(express.static(path.join(__dirname, 'dist')));
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🎙️  TTS Server corriendo en el puerto ${PORT}`);
  console.log(`   ├─ Frontend:   http://localhost:${PORT}`);
  console.log(`   ├─ Edge TTS:   POST /api/tts`);
  console.log(`   ├─ Two-Pass:   <swap> tags → Dalia + Aria`);
  console.log(`   └─ Health:     GET /api/health`);
});
