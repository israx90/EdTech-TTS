import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Play, Pause, Download, CheckCircle2, Loader2, Music, Sparkles, Clock, Volume2, Square, Cpu, Globe, Mic, Server, Wifi, WifiOff, RefreshCw, X, Package, Trash2, Tag } from 'lucide-react';
import { parseDocument } from './utils/DocumentParser';
import { processTextToAudioBlob, playVoiceDemo, stopVoiceDemo, getWebSpeechVoices, checkServerHealth } from './utils/TTSProcessor';
import JSZip from 'jszip';
import './index.css';

interface BatchItem {
  id: string;
  file: File;
  baseName: string;
  text: string;
  status: 'pending' | 'extracting' | 'extracted' | 'converting' | 'done' | 'error';
  progress?: { current: number; total: number };
  audioBlob?: Blob;
  audioUrl?: string;
  error?: string;
  wordCount: number;
}

// ═══════════════════════════════════════════
// Release Notes / Changelog
// ═══════════════════════════════════════════
const APP_VERSION = 'v2.6.5';
const RELEASE_LOG = [
  {
    version: 'v2.6.5',
    date: '2026-04-09',
    changes: [
      'PDF: Filtro "Bottom-Up Anchored Cut" para buscar retroactivamente inicios de citas académicas fragmentadas que carecen de marcadores bibliográficos en su primera línea.',
    ],
  },
  {
    version: 'v2.6.4',
    date: '2026-04-09',
    changes: [
      'PDF: Incorporación de "Separación Estructural (Eje Y)" para diferenciar oraciones que fluyen de página frente a separadores de notas.',
      'PDF: Filtro "cortafuegos" por ejes Y para descartar pies de página bibliográficos o citas multilínea',
      'PDF: Inclusión de "Puntos de Sutura" para garantizar que los cortes bibliográficos no mutilen oraciones en curso.',
      'PDF: Inyección proactiva de puntos en títulos y párrafos huérfanos antes de la oración en mayúsculas',
      'Mejorada fluidez TTS al eliminar saltos narrativos abruptos',
    ],
  },
  {
    version: 'v2.5.0',
    date: '2026-04-09',
    changes: [
      'TTS: Conversión inteligente de números romanos a arábigos (VI → 6)',
      'Algoritmo de detección con 3 estrategias contextuales (alta, media, referencias legales)',
      'Protección anti-falsos positivos para letras sueltas (I, C, D, M)',
      'Prefijos de contexto académico (UNIDAD, Capítulo, inciso, cuadro, etc.)',
      'TTS: Limpieza de guiones bajos, múltiples y aislados para evitar lectura de símbolos',
    ],
  },
  {
    version: 'v2.4.0',
    date: '2026-04-09',
    changes: [
      'DOCX: Tablas reemplazadas por placeholders verbales para TTS',
      'DOCX: Detección dual de títulos (celda + párrafo anterior)',
      'DOCX: Limpieza de captions post-tabla',
      'PDF: Detección y omisión de carátulas/portadas',
      'PDF: Normalización fuzzy de headers ("• 17 •" = "• 18 •")',
      'PDF: Patrones expandidos de numeración decorativa',
      'PDF: Umbral de repetición reducido (50% → 30%)',
      'PDF: Filtro endurecido para texto corto en headers/footers',
    ],
  },
  {
    version: 'v2.3.0',
    date: '2026-04-02',
    changes: [
      'Procesamiento batch multi-archivo (PDF, DOCX, TXT)',
      'Cola de conversión secuencial con estado individual',
      'Descarga ZIP para múltiples archivos',
      'Filtrado básico de headers/footers en PDF',
    ],
  },
];

function App() {
  // Batch queue
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [modelLoading, setModelLoading] = useState<string>('');
  
  // Release modal
  const [showRelease, setShowRelease] = useState(false);
  
  const [provider, setProvider] = useState('edge-tts');
  const [voice, setVoice] = useState('es-MX-DaliaNeural');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Server status for Edge TTS (multi-stage)
  const [serverStatus, setServerStatus] = useState<'idle' | 'checking' | 'waking' | 'online' | 'offline'>('idle');
  const [serverMessage, setServerMessage] = useState<string>('');
  const serverRetryRef = useRef<number>(0);
  
  // Web Speech voices
  const [webVoices, setWebVoices] = useState<SpeechSynthesisVoice[]>([]);
  
  // Demo playback
  const [playingDemo, setPlayingDemo] = useState(false);

  // Custom audio player (for previewing individual results)
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Audio format based on provider
  const audioFormat = provider === 'kokoro' ? 'wav' : 'mp3';

  // Total stats
  const totalWords = items.reduce((sum, it) => sum + it.wordCount, 0);
  const doneCount = items.filter(i => i.status === 'done').length;
  const errorCount = items.filter(i => i.status === 'error').length;

  // Server wake logic
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
    
    setServerStatus('waking');
    setServerMessage('Encendiendo máquina virtual...');
    
    const maxRetries = 12;
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

  useEffect(() => {
    const loadVoices = () => setWebVoices(getWebSpeechVoices());
    loadVoices();
    if ('speechSynthesis' in window) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    stopVoiceDemo();
    if (newProvider === 'edge-tts') setVoice('es-MX-DaliaNeural');
    else if (newProvider === 'kokoro') setVoice('af_heart');
    else {
      const voices = getWebSpeechVoices();
      setVoice(voices.length > 0 ? voices[0].voiceURI : '');
    }
  };

  // Provider metadata
  const PROVIDERS = [
    { id: 'edge-tts', label: 'Microsoft Azure', sub: 'Neural Premium', icon: <Mic size={16} />, description: 'Voces neuronales de Azure. Requiere servidor.' },
    { id: 'kokoro', label: 'Kokoro Neural', sub: 'Inteligencia Local', icon: <Cpu size={16} />, description: 'IA neural en tu navegador. ~80MB primera vez, luego en caché.' },
    { id: 'web-speech', label: 'Web Speech', sub: 'Nativo del Sistema', icon: <Globe size={16} />, description: 'Voces del sistema operativo. Solo reproducción en vivo.' },
  ];

  // ═════════════════════════════════════
  // File handling (multi-file)
  // ═════════════════════════════════════
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addFiles(Array.from(e.target.files));
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addFiles = async (newFiles: File[]) => {
    const validExts = ['txt', 'pdf', 'docx'];
    const filtered = newFiles.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return validExts.includes(ext || '');
    });

    if (filtered.length === 0) {
      alert('Solo se admiten archivos TXT, PDF y DOCX.');
      return;
    }

    // Extract text from each file
    const newItems: BatchItem[] = [];
    for (const file of filtered) {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      
      const item: BatchItem = {
        id, file, baseName, text: '', status: 'extracting', wordCount: 0
      };
      newItems.push(item);
    }

    setItems(prev => [...prev, ...newItems]);

    // Extract text for each new file
    for (const item of newItems) {
      try {
        const extractedText = await parseDocument(item.file);
        const wc = extractedText.split(/\s+/).filter(w => w.length > 0).length;
        setItems(prev => prev.map(i => 
          i.id === item.id 
            ? { ...i, text: extractedText, status: 'extracted', wordCount: wc } 
            : i
        ));
      } catch {
        setItems(prev => prev.map(i => 
          i.id === item.id 
            ? { ...i, status: 'error', error: 'Error extrayendo texto' } 
            : i
        ));
      }
    }
  };

  const removeItem = (id: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item?.audioUrl) URL.revokeObjectURL(item.audioUrl);
      return prev.filter(i => i.id !== id);
    });
    if (playingItemId === id) {
      audioRef.current?.pause();
      setPlayingItemId(null);
      setIsPlaying(false);
    }
  };

  const clearAll = () => {
    items.forEach(i => { if (i.audioUrl) URL.revokeObjectURL(i.audioUrl); });
    setItems([]);
    setPlayingItemId(null);
    setIsPlaying(false);
  };

  // ═════════════════════════════════════
  // Batch conversion
  // ═════════════════════════════════════
  const handleBatchConvert = async () => {
    const toProcess = items.filter(i => i.status === 'extracted');
    if (toProcess.length === 0) return;

    setIsBatchProcessing(true);

    for (const item of toProcess) {
      setItems(prev => prev.map(i => 
        i.id === item.id ? { ...i, status: 'converting', progress: { current: 0, total: 1 } } : i
      ));

      try {
        const audioBlob = await processTextToAudioBlob(item.text, {
          provider,
          voice,
          onProgress: (current, total) => {
            setItems(prev => prev.map(i => 
              i.id === item.id ? { ...i, progress: { current, total } } : i
            ));
          },
          onModelLoading: (status) => setModelLoading(status),
        });

        if (audioBlob) {
          const audioUrl = URL.createObjectURL(audioBlob);
          setItems(prev => prev.map(i => 
            i.id === item.id ? { ...i, status: 'done', audioBlob, audioUrl, progress: undefined } : i
          ));
        } else {
          // Web Speech live playback completed
          setItems(prev => prev.map(i => 
            i.id === item.id ? { ...i, status: 'done', progress: undefined } : i
          ));
        }
      } catch (err: any) {
        setItems(prev => prev.map(i => 
          i.id === item.id ? { ...i, status: 'error', error: err.message, progress: undefined } : i
        ));
      }
    }

    setIsBatchProcessing(false);
    setModelLoading('');
  };

  // ═════════════════════════════════════
  // Downloads
  // ═════════════════════════════════════
  const downloadSingle = (item: BatchItem) => {
    if (!item.audioUrl) return;
    const a = document.createElement('a');
    a.href = item.audioUrl;
    a.download = `${item.baseName}.${audioFormat}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadZip = async () => {
    const doneItems = items.filter(i => i.status === 'done' && i.audioBlob);
    if (doneItems.length === 0) return;

    const zip = new JSZip();
    for (const item of doneItems) {
      zip.file(`${item.baseName}.${audioFormat}`, item.audioBlob!);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EdTech-TTS_${doneItems.length}-archivos.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ═════════════════════════════════════
  // Audio player
  // ═════════════════════════════════════
  const playItem = (item: BatchItem) => {
    if (!item.audioUrl) return;
    
    if (playingItemId === item.id && isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }

    if (audioRef.current) {
      audioRef.current.src = item.audioUrl;
      audioRef.current.play();
      setPlayingItemId(item.id);
      setIsPlaying(true);
    }
  };

  const handlePlayDemo = () => {
    if (playingDemo) {
      stopVoiceDemo();
      setPlayingDemo(false);
    } else {
      setPlayingDemo(true);
      playVoiceDemo(provider, voice);
      setTimeout(() => setPlayingDemo(false), 4000);
    }
  };

  const canDownload = provider !== 'web-speech';
  const actionLabel = provider === 'web-speech' ? 'Reproducir en Vivo' : 'Sintetizar Todo';
  const readyCount = items.filter(i => i.status === 'extracted').length;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            className="release-btn"
            onClick={() => setShowRelease(true)}
            title="Notas de versión"
          >
            <Tag size={14} />
            {APP_VERSION}
          </button>
          <div className="status-badge">
            <div className="status-dot"></div>
            Platform Active
          </div>
        </div>
      </header>

      {/* Release Notes Modal */}
      {showRelease && (
        <div className="release-overlay" onClick={() => setShowRelease(false)}>
          <div className="release-modal" onClick={e => e.stopPropagation()}>
            <div className="release-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Tag size={18} className="text-cyber-teal" />
                <span>Release Notes</span>
              </div>
              <button className="release-close-btn" onClick={() => setShowRelease(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="release-modal-body">
              {RELEASE_LOG.map((release, idx) => (
                <div key={release.version} className={`release-entry ${idx === 0 ? 'latest' : ''}`}>
                  <div className="release-entry-header">
                    <span className="release-version">{release.version}</span>
                    {idx === 0 && <span className="release-latest-tag">LATEST</span>}
                    <span className="release-date">{release.date}</span>
                  </div>
                  <ul className="release-changes">
                    {release.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid-2">
        {/* Left: Document Upload + Queue */}
        <div className="panel">
          <div className="panel-header">
            <FileText size={20} className="text-cyber-teal" />
            <span>Documentos</span>
            {items.length > 0 && (
              <span className="header-badge">{items.length}</span>
            )}
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
              multiple
              onChange={handleFileChange}
            />
            <UploadCloud size={40} className="dropzone-icon" />
            <div className="dropzone-text">
              {items.length === 0 
                ? 'Haz clic o arrastra tus archivos aquí' 
                : 'Agregar más archivos'}
            </div>
            <div className="dropzone-subtext">Soporta PDF, DOCX, TXT — múltiples archivos</div>
          </div>

          {/* File Queue */}
          {items.length > 0 && (
            <>
              <div className="batch-list">
                {items.map(item => (
                  <div key={item.id} className={`batch-item ${item.status}`}>
                    <div className="batch-item-info">
                      <div className="batch-item-icon">
                        {item.status === 'extracting' && <Loader2 size={14} className="spinner" />}
                        {item.status === 'extracted' && <FileText size={14} />}
                        {item.status === 'converting' && <Loader2 size={14} className="spinner" />}
                        {item.status === 'done' && <CheckCircle2 size={14} />}
                        {item.status === 'error' && <X size={14} />}
                        {item.status === 'pending' && <Clock size={14} />}
                      </div>
                      <div className="batch-item-details">
                        <div className="batch-item-name">{item.file.name}</div>
                        <div className="batch-item-meta">
                          {item.status === 'extracting' && 'Extrayendo texto...'}
                          {item.status === 'extracted' && `${item.wordCount.toLocaleString()} palabras`}
                          {item.status === 'converting' && (item.progress 
                            ? `Bloque ${item.progress.current + 1}/${item.progress.total}`
                            : 'Procesando...')}
                          {item.status === 'done' && 'Completado'}
                          {item.status === 'error' && (item.error || 'Error')}
                        </div>
                      </div>
                    </div>
                    <div className="batch-item-actions">
                      {item.status === 'done' && item.audioUrl && canDownload && (
                        <>
                          <button className="batch-action-btn" onClick={() => playItem(item)} title="Reproducir">
                            {playingItemId === item.id && isPlaying ? <Pause size={14} /> : <Play size={14} />}
                          </button>
                          <button className="batch-action-btn" onClick={() => downloadSingle(item)} title="Descargar">
                            <Download size={14} />
                          </button>
                        </>
                      )}
                      {!isBatchProcessing && (
                        <button className="batch-action-btn delete" onClick={() => removeItem(item.id)} title="Eliminar">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Batch Stats */}
              <div className="stats-grid" style={{ marginTop: '1rem' }}>
                <div className="stat-card">
                  <div className="stat-value">{items.length}</div>
                  <div className="stat-label">Archivos</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{totalWords.toLocaleString()}</div>
                  <div className="stat-label">Palabras Total</div>
                </div>
                {doneCount > 0 && (
                  <div className="stat-card" style={{ gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <CheckCircle2 size={16} className="text-cyber-teal" />
                      <div className="stat-value" style={{ fontSize: '1rem' }}>
                        {doneCount}/{items.length} completados
                        {errorCount > 0 && <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>({errorCount} errores)</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {!isBatchProcessing && (
                <button className="btn btn-secondary w-full mt-3" onClick={clearAll} style={{ fontSize: '0.8rem' }}>
                  <Trash2 size={14} />
                  Limpiar Cola
                </button>
              )}
            </>
          )}
        </div>

        {/* Right: Voice Engine Config */}
        <div className="panel">
          <div className="panel-header">
            <Sparkles size={20} className="text-cyber-teal" />
            <span>Motor de Voz</span>
          </div>

          {/* Provider Cards */}
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
                  <div className="server-progress-bar" style={{ width: `${Math.min((serverRetryRef.current / 12) * 100, 95)}%` }}></div>
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
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                    ))
                  ) : (
                    <option value="">Cargando voces del sistema...</option>
                  )
                )}
              </select>
              <button className="btn-demo" onClick={handlePlayDemo} title={playingDemo ? 'Detener demo' : 'Escuchar demo'}>
                {playingDemo ? <Square size={16} /> : <Volume2 size={16} />}
              </button>
            </div>
            <div className="provider-helper">
              {PROVIDERS.find(p => p.id === provider)?.description}
              {provider === 'web-speech' && <span className="live-only-tag">Solo reproducción en vivo</span>}
            </div>
          </div>

          {/* Model Loading */}
          {modelLoading && (
            <div className="model-loading">
              <Loader2 size={16} className="spinner" />
              <span>{modelLoading}</span>
            </div>
          )}

          {/* Batch Convert Button */}
          <div className="action-container">
            <button 
              className="btn btn-action flush-btn" 
              onClick={handleBatchConvert}
              disabled={readyCount === 0 || isBatchProcessing}
            >
              {isBatchProcessing ? (
                <>
                  <Loader2 size={18} className="spinner" />
                  {modelLoading || 'Procesando lote...'}
                </>
              ) : (
                <>
                  <Play size={18} />
                  {readyCount > 0 
                    ? `${actionLabel} (${readyCount} archivo${readyCount > 1 ? 's' : ''})` 
                    : actionLabel}
                </>
              )}
            </button>
          </div>

          {/* ZIP Download */}
          {doneCount > 1 && canDownload && (
            <button className="btn btn-zip w-full mt-3" onClick={downloadZip}>
              <Package size={18} />
              Descargar ZIP ({doneCount} archivos)
            </button>
          )}

          {/* Single file player (hidden audio element) */}
          <audio 
            ref={audioRef}
            onTimeUpdate={() => { if (audioRef.current) setCurrentTime(audioRef.current.currentTime); }}
            onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
            onEnded={() => { setIsPlaying(false); setPlayingItemId(null); }}
            style={{ display: 'none' }}
          />

          {/* Inline player when something is playing */}
          {playingItemId && (
            <div className="audio-console">
              <div className="panel-header borderless small-header text-cyber-teal">
                <Music size={16} />
                <span>Reproduciendo</span>
              </div>
              <div className="file-tag mb-3">
                {items.find(i => i.id === playingItemId)?.baseName || 'audio'}.{audioFormat}
              </div>
              <div className="custom-player">
                <button className="player-btn" onClick={() => {
                  if (!audioRef.current) return;
                  if (isPlaying) audioRef.current.pause();
                  else audioRef.current.play();
                  setIsPlaying(!isPlaying);
                }}>
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <span className="player-time">{formatTime(currentTime)}</span>
                <div className="player-track">
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      if (audioRef.current) audioRef.current.currentTime = t;
                      setCurrentTime(t);
                    }}
                    className="player-seek"
                  />
                </div>
                <span className="player-time">{formatTime(duration)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default App;
