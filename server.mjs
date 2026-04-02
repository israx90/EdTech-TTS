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
    'http://localhost:3000',
    'https://israx90.github.io'
  ],
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '5mb' }));

// ═══════════════════════════════════════════════
// Endpoint: Microsoft Edge TTS (Azure Neural)
// ═══════════════════════════════════════════════
app.post('/api/tts', async (req, res) => {
  const { text, voice } = req.body;
  
  if (!text || !voice) {
    return res.status(400).json({ error: 'Missing text or voice' });
  }

  try {
    const { EdgeTTS } = await import('edge-tts-universal');
    const edgeTTS = new EdgeTTS(text, voice);
    const result = await edgeTTS.synthesize();
    
    const arrayBuffer = await result.audio.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', buffer.length);
    res.send(buffer);
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
  console.log(`   └─ Health:     GET /api/health`);
});
