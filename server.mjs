import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ═══════════════════════════════════════════════
// Endpoint 1: Microsoft Edge TTS (Azure Neural)
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
// Endpoint 2: Google Translate TTS
// ═══════════════════════════════════════════════
app.post('/api/google-tts', async (req, res) => {
  const { text, lang } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }

  const language = lang || 'es';

  try {
    // Google Translate TTS tiene límite de ~200 chars por request
    // Dividimos en fragmentos pequeños y concatenamos
    const chunks = splitForGoogle(text, 190);
    const audioBuffers = [];

    for (const chunk of chunks) {
      const encoded = encodeURIComponent(chunk);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${language}&client=tw-ob&ttsspeed=1`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://translate.google.com/'
        }
      });

      if (!response.ok) {
        throw new Error(`Google TTS returned ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      audioBuffers.push(Buffer.from(arrayBuffer));
    }

    // Concatenar todos los buffers MP3
    const finalBuffer = Buffer.concat(audioBuffers);
    
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', finalBuffer.length);
    res.send(finalBuffer);
  } catch (err) {
    console.error('Google TTS Error:', err);
    res.status(500).json({ error: err.message || 'Google TTS failed' });
  }
});

function splitForGoogle(text, maxLen = 190) {
  const result = [];
  let pos = 0;
  
  while (pos < text.length) {
    if (text.length - pos <= maxLen) {
      result.push(text.slice(pos));
      break;
    }
    
    let end = pos + maxLen;
    const section = text.substring(pos, end);
    
    // Cortar en punto, coma o espacio
    const lastPeriod = section.lastIndexOf('. ');
    const lastComma = section.lastIndexOf(', ');
    const lastSpace = section.lastIndexOf(' ');
    
    if (lastPeriod > maxLen / 2) {
      end = pos + lastPeriod + 2;
    } else if (lastComma > maxLen / 2) {
      end = pos + lastComma + 2;
    } else if (lastSpace > maxLen / 2) {
      end = pos + lastSpace + 1;
    }
    
    result.push(text.slice(pos, end));
    pos = end;
  }
  
  return result;
}

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🎙️  TTS Server corriendo en http://localhost:${PORT}`);
  console.log(`   ├─ Edge TTS:   POST /api/tts`);
  console.log(`   └─ Google TTS: POST /api/google-tts`);
});
