import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Play, Download, CheckCircle2, Loader2, Music, Sparkles, Clock, Volume2, Square, Cpu, Globe, Mic, Server, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { parseDocument } from './utils/DocumentParser';
import { processTextToAudioBlob, playVoiceDemo, stopVoiceDemo, getWebSpeechVoices, checkServerHealth } from './utils/TTSProcessor';
import './index.css';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState<string>('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState<{current: number, total: number} | null>(null);
  const [modelLoading, setModelLoading] = useState<string>('');
  
  const [provider, setProvider] = useState('edge-tts');
  const [voice, setVoice] = useState('es-MX-DaliaNeural');
  
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFormat, setAudioFormat] = useState<string>('mp3');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Server status for Edge TTS (multi-stage)
  const [serverStatus, setServerStatus] = useState<'idle' | 'checking' | 'waking' | 'online' | 'offline'>('idle');
  const [serverMessage, setServerMessage] = useState<string>('');
  const serverRetryRef = useRef<number>(0);
  
  // Web Speech voices (loaded async)
  const [webVoices, setWebVoices] = useState<SpeechSynthesisVoice[]>([]);
  
  // Demo playback state
  const [playingDemo, setPlayingDemo] = useState(false);

  // File base name
  const fileBaseName = file?.name.replace(/\.[^/.]+$/, '') || 'audio';

  // Duration estimate: ~150 words/min for Spanish narration
  const wordCount = text ? text.split(/\s+/).filter(w => w.length > 0).length : 0;
  const estimatedMinutes = Math.ceil(wordCount / 150);
  const estimatedDisplay = estimatedMinutes < 1 
    ? 'Menos de 1 min' 
    : estimatedMinutes < 60 
      ? `~${estimatedMinutes} min` 
      : `~${Math.floor(estimatedMinutes / 60)}h ${estimatedMinutes % 60}min`;

  // Check server health with progressive status
  const wakeServer = async () => {
    setServerStatus('checking');
    setServerMessage('Verificando conexión...');
    
    const ok = await checkServerHealth();
    if (ok) {
      setServerStatus('online');
      setServerMessage('Servidor conectado');
      serverRetryRef.current = 0;
      return;
    }
    
    // Server is sleeping — start wake-up sequence
    setServerStatus('waking');
    setServerMessage('Encendiendo máquina virtual...');
    
    const maxRetries = 12; // ~60 seconds total
    const messages = [
      'Encendiendo máquina virtual...',
      'Iniciando servidor...',
      'Cargando dependencias...',
      'Estableciendo conexión...',
      'Casi listo...',
    ];
    
    for (let i = 0; i < maxRetries; i++) {
      serverRetryRef.current = i + 1;
      setServerMessage(messages[Math.min(i, messages.length - 1)]);
      
      await new Promise(r => setTimeout(r, 5000));
      
      const alive = await checkServerHealth();
      if (alive) {
        setServerStatus('online');
        setServerMessage('Servidor conectado');
        serverRetryRef.current = 0;
        return;
      }
    }
    
    setServerStatus('offline');
    setServerMessage('No se pudo conectar al servidor');
  };

  useEffect(() => {
    if (provider === 'edge-tts') {
      wakeServer();
    } else {
      setServerStatus('idle');
    }
  }, [provider]);

  // Load Web Speech voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = getWebSpeechVoices();
      setWebVoices(voices);
    };
    loadVoices();
    if ('speechSynthesis' in window) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    setAudioUrl(null);
    stopVoiceDemo();
    
    if (newProvider === 'edge-tts') {
      setVoice('es-MX-DaliaNeural');
    } else if (newProvider === 'kokoro') {
      setVoice('af_heart');
    } else {
      // Web Speech: pick first Spanish voice
      const voices = getWebSpeechVoices();
      setVoice(voices.length > 0 ? voices[0].voiceURI : '');
    }
  };

  // Provider metadata
  const PROVIDERS = [
    { 
      id: 'edge-tts', 
      label: 'Microsoft Azure', 
      sub: 'Neural Premium',
      icon: <Mic size={16} />,
      description: 'Voces neuronales de Azure. Requiere servidor.'
    },
    { 
      id: 'kokoro', 
      label: 'Kokoro Neural', 
      sub: 'Inteligencia Local',
      icon: <Cpu size={16} />,
      description: 'IA neural en tu navegador. ~80MB primera vez, luego en caché.'
    },
    { 
      id: 'web-speech', 
      label: 'Web Speech',
      sub: 'Nativo del Sistema',
      icon: <Globe size={16} />,
      description: 'Voces del sistema operativo. Solo reproducción en vivo.'
    },
  ];

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await handleFileSelect(e.target.files[0]);
    }
  };

  const handleFileSelect = async (selectedFile: File) => {
    const ext = selectedFile.name.split('.').pop()?.toLowerCase();
    if (!['txt', 'pdf', 'docx'].includes(ext || '')) {
      alert('Solo se admiten archivos TXT, PDF y DOCX.');
      return;
    }
    
    setFile(selectedFile);
    setAudioUrl(null);
    setProgress(null);
    setIsExtracting(true);
    
    try {
      const extractedContent = await parseDocument(selectedFile);
      setText(extractedContent);
    } catch (err) {
      console.error(err);
      alert('Error extrayendo texto del documento.');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleConvert = async () => {
    if (!text) return;

    setIsConverting(true);
    setProgress({ current: 0, total: 1 });
    
    try {
      const audioBlob = await processTextToAudioBlob(text, {
        provider,
        voice,
        onProgress: (current, total) => {
          setProgress({ current, total });
        },
        onModelLoading: (status) => {
          setModelLoading(status);
        }
      });
      
      if (audioBlob) {
        // Edge TTS and Kokoro produce downloadable files
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setAudioFormat(provider === 'kokoro' ? 'wav' : 'mp3');
      } else {
        // Web Speech API: live playback completed
        setAudioUrl(null);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Error al generar audio: ${err.message || 'Error desconocido'}`);
    } finally {
      setIsConverting(false);
      setProgress(null);
      setModelLoading('');
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${fileBaseName}.${audioFormat}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePlayDemo = () => {
    if (playingDemo) {
      stopVoiceDemo();
      setPlayingDemo(false);
    } else {
      setPlayingDemo(true);
      playVoiceDemo(provider, voice);
      // Auto-reset after demo plays (estimate ~4s)
      setTimeout(() => setPlayingDemo(false), 4000);
    }
  };

  // Is current config capable of producing a downloadable file?
  const canDownload = provider !== 'web-speech';
  const actionLabel = provider === 'web-speech' ? 'Reproducir en Vivo' : 'Sintetizar Audio';

  return (
    <div className="app-container">
      <header className="app-main-header">
        <div className="brand-wrapper">
          <h1 className="brand-title">
            <Sparkles size={24} className="brand-icon" />
            EdTech-TTS
          </h1>
          <div className="brand-subtitle">Text-to-Speech Processing Engine</div>
        </div>
        <div className="status-badge">
          <div className="status-dot"></div>
          Platform Active
        </div>
      </header>

      <div className="grid-2">
        {/* Left: Document Upload */}
        <div className="panel">
          <div className="panel-header">
            <FileText size={20} className="text-cyber-teal" />
            <span>Documento Origen</span>
          </div>
          
          <div 
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{display: 'none'}} 
              accept=".txt,.pdf,.docx"
              onChange={handleFileChange}
            />
            
            {isExtracting ? (
              <div>
                <Loader2 size={48} className="dropzone-icon spinner" />
                <div className="dropzone-text">Extrayendo texto...</div>
              </div>
            ) : file ? (
              <div>
                <CheckCircle2 size={48} className="dropzone-icon" />
                <div className="dropzone-text">{file.name}</div>
                <div className="dropzone-subtext">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ) : (
              <div>
                <UploadCloud size={48} className="dropzone-icon" />
                <div className="dropzone-text">Haz clic o arrastra tu archivo aquí</div>
                <div className="dropzone-subtext">Soporta PDF, DOCX, TXT</div>
              </div>
            )}
          </div>

          {text && !isExtracting && (
            <div className="stats-grid" style={{ marginTop: '1.5rem' }}>
              <div className="stat-card">
                <div className="stat-value">{text.length.toLocaleString()}</div>
                <div className="stat-label">Caracteres</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{wordCount.toLocaleString()}</div>
                <div className="stat-label">Palabras</div>
              </div>
              <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <Clock size={18} className="text-cyber-teal" />
                  <div className="stat-value" style={{ fontSize: '1.1rem' }}>{estimatedDisplay}</div>
                </div>
                <div className="stat-label">Duración estimada del audio</div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Voice Engine Config */}
        <div className="panel">
          <div className="panel-header">
            <Sparkles size={20} className="text-cyber-teal" />
            <span>Motor de Voz</span>
          </div>

          {/* Provider Selector (Cards) */}
          <div className="form-group">
            <label className="form-label text-cyber-teal flex-label">
              <Sparkles size={14} className="icon-subtle" />
              Motor de Síntesis
            </label>
            <div className="provider-cards">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  className={`provider-card ${provider === p.id ? 'active' : ''}`}
                  onClick={() => handleProviderChange(p.id)}
                >
                  <div className="provider-card-icon">{p.icon}</div>
                  <div className="provider-card-info">
                    <div className="provider-card-label">{p.label}</div>
                    <div className="provider-card-sub">{p.sub}</div>
                  </div>
                  {provider === p.id && p.id === 'edge-tts' && (
                    <div className={`server-dot ${serverStatus}`}></div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Server Status Banner */}
          {provider === 'edge-tts' && serverStatus !== 'idle' && serverStatus !== 'online' && (
            <div className={`server-status-banner ${serverStatus}`}>
              <div className="server-status-content">
                {serverStatus === 'checking' && <Loader2 size={14} className="spinner" />}
                {serverStatus === 'waking' && <Server size={14} className="server-pulse" />}
                {serverStatus === 'offline' && <WifiOff size={14} />}
                <span>{serverMessage}</span>
              </div>
              {serverStatus === 'waking' && (
                <div className="server-progress">
                  <div 
                    className="server-progress-bar" 
                    style={{ width: `${Math.min((serverRetryRef.current / 12) * 100, 95)}%` }}
                  ></div>
                </div>
              )}
              {serverStatus === 'offline' && (
                <button className="server-retry-btn" onClick={wakeServer}>
                  <RefreshCw size={12} />
                  Reintentar
                </button>
              )}
            </div>
          )}
          {provider === 'edge-tts' && serverStatus === 'online' && (
            <div className="server-status-banner online">
              <div className="server-status-content">
                <Wifi size={14} />
                <span>Servidor conectado</span>
              </div>
            </div>
          )}

          {/* Voice Selector */}
          <div className="form-group mt-2">
            <label className="form-label flex-label">
              <FileText size={14} className="icon-subtle" />
              Perfil de Voz
            </label>
            <div className="voice-selector-row">
              <select className="form-select voice-select" value={voice} onChange={e => setVoice(e.target.value)}>
                {provider === 'edge-tts' && (
                  <>
                    <optgroup label="Español (México)">
                      <option value="es-MX-DaliaNeural">Dalia (Femenino - Premium)</option>
                      <option value="es-MX-JorgeNeural">Jorge (Masculino - Dinámico)</option>
                    </optgroup>
                    <optgroup label="Español (Argentina)">
                      <option value="es-AR-ElenaNeural">Elena (Femenino)</option>
                      <option value="es-AR-TomasNeural">Tomás (Masculino)</option>
                    </optgroup>
                    <optgroup label="Español (Colombia)">
                      <option value="es-CO-SalomeNeural">Salomé (Femenino)</option>
                      <option value="es-CO-GonzaloNeural">Gonzalo (Masculino)</option>
                    </optgroup>
                    <optgroup label="Español (Chile)">
                      <option value="es-CL-CatalinaNeural">Catalina (Femenino)</option>
                      <option value="es-CL-LorenzoNeural">Lorenzo (Masculino)</option>
                    </optgroup>
                    <optgroup label="Español (España)">
                      <option value="es-ES-ElviraNeural">Elvira (Femenino)</option>
                      <option value="es-ES-AlvaroNeural">Álvaro (Masculino)</option>
                    </optgroup>
                  </>
                )}
                {provider === 'kokoro' && (
                  <>
                    <optgroup label="Femenino">
                      <option value="af_heart">Heart (Femenino - Top Quality)</option>
                      <option value="af_bella">Bella (Femenino)</option>
                      <option value="af_sarah">Sarah (Femenino)</option>
                    </optgroup>
                    <optgroup label="Masculino">
                      <option value="am_michael">Michael (Masculino)</option>
                      <option value="am_fenrir">Fenrir (Masculino)</option>
                      <option value="bm_george">George (Masculino - British)</option>
                    </optgroup>
                  </>
                )}
                {provider === 'web-speech' && (
                  webVoices.length > 0 ? (
                    webVoices.map(v => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))
                  ) : (
                    <option value="">Cargando voces del sistema...</option>
                  )
                )}
              </select>
              <button 
                className="btn-demo" 
                onClick={handlePlayDemo}
                title={playingDemo ? 'Detener demo' : 'Escuchar demo'}
              >
                {playingDemo ? <Square size={16} /> : <Volume2 size={16} />}
              </button>
            </div>
            <div className="provider-helper">
              {PROVIDERS.find(p => p.id === provider)?.description}
              {provider === 'web-speech' && (
                <span className="live-only-tag">Solo reproducción en vivo</span>
              )}
            </div>
          </div>

          {/* Model Loading Indicator */}
          {modelLoading && (
            <div className="model-loading">
              <Loader2 size={16} className="spinner" />
              <span>{modelLoading}</span>
            </div>
          )}

          {/* Convert Button */}
          <div className="action-container">
            <button 
              className="btn btn-action flush-btn" 
              onClick={handleConvert}
              disabled={!file || text.length === 0 || isConverting || isExtracting}
            >
              {isConverting ? (
                <>
                  <Loader2 size={18} className="spinner" />
                  {modelLoading 
                    ? modelLoading 
                    : progress 
                      ? `Sintetizando Bloque ${progress.current + 1}/${progress.total}` 
                      : 'Iniciando Procesamiento...'}
                </>
              ) : (
                <>
                  <Play size={18} />
                  {actionLabel}
                </>
              )}
            </button>
          </div>

          {/* Audio Output Console */}
          {audioUrl && canDownload && (
            <div className="audio-console">
              <div className="panel-header borderless small-header text-cyber-teal">
                <Music size={16} />
                <span>Consola de Salida</span>
              </div>
              <div className="file-tag mb-3">{fileBaseName}.{audioFormat}</div>
              <audio controls src={audioUrl} className="cyber-audio" />
              <button className="btn btn-secondary w-full mt-3" onClick={handleDownload}>
                <Download size={18} />
                Descargar {audioFormat.toUpperCase()} Exportado
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
