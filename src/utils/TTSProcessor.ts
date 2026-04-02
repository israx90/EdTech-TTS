import { prepareTextForNarration } from './NarrativePreprocessor';

export interface TTSOptions {
  provider?: string;
  voice?: string;
  onProgress?: (progress: number, total: number) => void;
  onModelLoading?: (status: string) => void;
}

// ═══════════════════════════════════════════════
// Auto-detect API URL: localhost for dev, Render for production
// ═══════════════════════════════════════════════
const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }
  // Production: Render.com server URL
  // Update this after deploying to Render
  return 'https://edtech-tts.onrender.com';
};

// Kokoro model singleton (lazy-loaded)
let kokoroInstance: any = null;
let kokoroLoading = false;

// ═══════════════════════════════════════════════
// Main entry point
// ═══════════════════════════════════════════════
export async function processTextToAudioBlob(
  text: string, 
  options: TTSOptions
): Promise<Blob | null> {
  const narrativeText = prepareTextForNarration(text);
  const cleanText = narrativeText.replace(/\s+/g, ' ').trim();

  switch (options.provider) {
    case 'kokoro':
      return await processKokoroTTS(cleanText, options);
    case 'web-speech':
      await processWebSpeechLive(cleanText, options);
      return null; // Web Speech is live playback only
    default: // 'edge-tts'
      return await processEdgeTTS(cleanText, options);
  }
}

// ═══════════════════════════════════════════════
// Engine 1: Microsoft Azure Edge TTS (via server)
// ═══════════════════════════════════════════════
async function processEdgeTTS(text: string, options: TTSOptions): Promise<Blob> {
  const API_URL = `${getApiBaseUrl()}/api/tts`;
  const chunks = chunkText(text, 2500);
  const audioBlobs: Blob[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;

    options.onProgress?.(i, chunks.length);

    try {
      const response = await fetch(API_URL, {
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
      // Add user-friendly error for connection issues
      if (e.message === 'Failed to fetch') {
        throw new Error(
          `No se pudo conectar al servidor TTS. ` +
          `Si es la primera vez, el servidor puede tardar ~30s en despertar. ` +
          `Intenta de nuevo en un momento.`
        );
      }
      throw new Error(`Error en parte ${i + 1}/${chunks.length}: ${e.message}`);
    }
  }

  options.onProgress?.(chunks.length, chunks.length);
  return new Blob(audioBlobs, { type: 'audio/mpeg' });
}

// ═══════════════════════════════════════════════
// Engine 2: Kokoro Neural TTS (client-side WASM)
// ═══════════════════════════════════════════════
async function processKokoroTTS(text: string, options: TTSOptions): Promise<Blob> {
  // Lazy-load Kokoro model
  if (!kokoroInstance && !kokoroLoading) {
    kokoroLoading = true;
    options.onModelLoading?.('Descargando modelo neural Kokoro (~80MB)...');
    
    try {
      const { KokoroTTS } = await import('kokoro-js');
      kokoroInstance = await KokoroTTS.from_pretrained(
        'onnx-community/Kokoro-82M-v1.0-ONNX',
        { dtype: 'q8', device: 'wasm' }
      );
    } catch (err: any) {
      kokoroLoading = false;
      throw new Error(`Error cargando modelo Kokoro: ${err.message}`);
    }
    
    kokoroLoading = false;
    options.onModelLoading?.('');
  }

  // Wait if another call triggered loading
  while (kokoroLoading) {
    await new Promise(r => setTimeout(r, 200));
  }

  if (!kokoroInstance) {
    throw new Error('No se pudo inicializar el modelo Kokoro.');
  }

  const chunks = chunkText(text, 500);
  const allSamples: Float32Array[] = [];
  let sampleRate = 24000;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;

    options.onProgress?.(i, chunks.length);

    try {
      const audio = await kokoroInstance.generate(chunk, {
        voice: options.voice || 'ef_dora',
      });
      
      // Kokoro returns audio with .data (Float32Array) and .sampling_rate
      if (audio.sampling_rate) sampleRate = audio.sampling_rate;
      allSamples.push(audio.data || new Float32Array(0));
    } catch (e: any) {
      console.error(`Kokoro chunk ${i} error:`, e);
      throw new Error(`Error en parte ${i + 1}/${chunks.length}: ${e.message}`);
    }
  }

  options.onProgress?.(chunks.length, chunks.length);

  // Combine all samples and encode as WAV
  const totalLength = allSamples.reduce((sum, s) => sum + s.length, 0);
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const samples of allSamples) {
    combined.set(samples, offset);
    offset += samples.length;
  }

  return encodeWAV(combined, sampleRate);
}

// ═══════════════════════════════════════════════
// Engine 3: Web Speech API (live playback only)
// ═══════════════════════════════════════════════
async function processWebSpeechLive(text: string, options: TTSOptions): Promise<void> {
  if (!('speechSynthesis' in window)) {
    throw new Error('Tu navegador no soporta Web Speech API.');
  }

  // Cancel any ongoing speech
  speechSynthesis.cancel();
  
  const chunks = chunkText(text, 200);
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;
    
    options.onProgress?.(i, chunks.length);
    
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      
      const voices = speechSynthesis.getVoices();
      const selectedVoice = voices.find(v => v.voiceURI === options.voice);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.lang = 'es';
      utterance.rate = 1;
      
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(new Error(`Speech error: ${e.error}`));
      
      speechSynthesis.speak(utterance);
    });
  }
  
  options.onProgress?.(chunks.length, chunks.length);
}

// ═══════════════════════════════════════════════
// Voice demo helpers
// ═══════════════════════════════════════════════
const basePath = import.meta.env.BASE_URL || '/';
let currentDemoAudio: HTMLAudioElement | null = null;

export function playVoiceDemo(provider: string, voice: string): void {
  // Stop any currently playing demo
  stopVoiceDemo();

  if (provider === 'web-speech') {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      'Hola, esta es una demostración de mi voz.'
    );
    const voices = speechSynthesis.getVoices();
    const match = voices.find(v => v.voiceURI === voice);
    if (match) utterance.voice = match;
    utterance.lang = 'es';
    speechSynthesis.speak(utterance);
    return;
  }

  // For Edge TTS and Kokoro: play pre-generated demo file
  let demoFile: string;
  if (provider === 'kokoro') {
    demoFile = `${basePath}demos/kokoro_${voice}.wav`;
  } else {
    demoFile = `${basePath}demos/edge_${voice}.mp3`;
  }
  
  currentDemoAudio = new Audio(demoFile);
  currentDemoAudio.play().catch(err => {
    console.warn('Demo playback failed:', err);
  });
}

export function stopVoiceDemo(): void {
  if (currentDemoAudio) {
    currentDemoAudio.pause();
    currentDemoAudio.currentTime = 0;
    currentDemoAudio = null;
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
}

export function getWebSpeechVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter(v => v.lang.startsWith('es'));
}

// ═══════════════════════════════════════════════
// Server health check
// ═══════════════════════════════════════════════
export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════
// WAV encoder (for Kokoro PCM → downloadable file)
// ═══════════════════════════════════════════════
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples (float32 → int16)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// ═══════════════════════════════════════════════
// Text chunking utility
// ═══════════════════════════════════════════════
function chunkText(text: string, maxLen = 2500): string[] {
  const result: string[] = [];
  let currentPos = 0;
  
  while (currentPos < text.length) {
    if (text.length - currentPos <= maxLen) {
      result.push(text.slice(currentPos));
      break;
    }
    
    let endPos = currentPos + maxLen;
    
    const section = text.substring(currentPos, endPos);
    const lastNewline = section.lastIndexOf('\n');
    const lastPeriod = section.lastIndexOf('. ');
    
    if (lastNewline > maxLen / 2) {
      endPos = currentPos + lastNewline + 1;
    } else if (lastPeriod > maxLen / 2) {
      endPos = currentPos + lastPeriod + 2;
    } else {
      while (endPos > currentPos && text[endPos] !== ' ') {
        endPos--;
      }
      if (endPos === currentPos) {
        endPos = currentPos + maxLen;
      }
    }
    
    result.push(text.slice(currentPos, endPos));
    currentPos = endPos;
  }
  
  return result;
}
