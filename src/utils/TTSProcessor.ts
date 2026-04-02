import { prepareTextForNarration } from './NarrativePreprocessor';

export interface TTSOptions {
  provider?: string;
  voice?: string;
  onProgress?: (progress: number, total: number) => void;
}

const EDGE_TTS_SERVER = 'http://localhost:3001/api/tts';
const GOOGLE_TTS_SERVER = 'http://localhost:3001/api/google-tts';

export async function processTextToAudioBlob(text: string, options: TTSOptions): Promise<Blob> {
  const narrativeText = prepareTextForNarration(text);
  const cleanText = narrativeText.replace(/\s+/g, ' ').trim();

  // Google TTS se maneja en el servidor (chunking interno de 190 chars)
  // Edge TTS acepta textos más largos, chunks de 2500
  // Web Speech API se maneja directamente en el navegador (ver App.tsx)
  
  if (options.provider === 'google') {
    return await processGoogleTTS(cleanText, options);
  }
  
  // Edge TTS (por defecto)
  return await processEdgeTTS(cleanText, options);
}

async function processEdgeTTS(text: string, options: TTSOptions): Promise<Blob> {
  const chunks = chunkText(text, 2500);
  const audioBlobs: Blob[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;

    options.onProgress?.(i, chunks.length);

    try {
      const response = await fetch(EDGE_TTS_SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: chunk,
          voice: options.voice || 'es-MX-DaliaNeural'
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }

      audioBlobs.push(await response.blob());
    } catch (e: any) {
      console.error(`Error chunk ${i}:`, e);
      throw new Error(`Error en parte ${i + 1}/${chunks.length}: ${e.message}`);
    }
  }

  options.onProgress?.(chunks.length, chunks.length);
  return new Blob(audioBlobs, { type: 'audio/mpeg' });
}

async function processGoogleTTS(text: string, options: TTSOptions): Promise<Blob> {
  // Google TTS: el servidor hace el chunking interno a 190 chars
  // Pero para textos muy largos, dividimos en bloques de ~2000 chars
  const chunks = chunkText(text, 2000);
  const audioBlobs: Blob[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;

    options.onProgress?.(i, chunks.length);

    try {
      const response = await fetch(GOOGLE_TTS_SERVER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: chunk,
          lang: options.voice || 'es'  // Para Google, voice = código de idioma
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }

      audioBlobs.push(await response.blob());
    } catch (e: any) {
      console.error(`Error chunk ${i}:`, e);
      throw new Error(`Error en parte ${i + 1}/${chunks.length}: ${e.message}`);
    }
  }

  options.onProgress?.(chunks.length, chunks.length);
  return new Blob(audioBlobs, { type: 'audio/mpeg' });
}

function chunkText(text: string, maxLen = 2500): string[] {
  const result: string[] = [];
  let currentPos = 0;
  
  while (currentPos < text.length) {
    if (text.length - currentPos <= maxLen) {
      result.push(text.slice(currentPos));
      break;
    }
    
    let endPos = currentPos + maxLen;
    let foundBreak = false;
    
    const section = text.substring(currentPos, endPos);
    const lastNewline = section.lastIndexOf('\n');
    const lastPeriod = section.lastIndexOf('. ');
    
    if (lastNewline > maxLen / 2) {
      endPos = currentPos + lastNewline + 1;
      foundBreak = true;
    } else if (lastPeriod > maxLen / 2) {
      endPos = currentPos + lastPeriod + 2;
      foundBreak = true;
    } else {
      while (endPos > currentPos && text[endPos] !== ' ') {
        endPos--;
      }
      if (endPos > currentPos) {
        foundBreak = true;
      }
    }
    
    if (!foundBreak || endPos === currentPos) {
      endPos = currentPos + maxLen;
    }
    
    result.push(text.slice(currentPos, endPos));
    currentPos = endPos;
  }
  
  return result;
}
