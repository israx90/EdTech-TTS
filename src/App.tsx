import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, Play, Download, CheckCircle2, Loader2, Music, Sparkles, Clock } from 'lucide-react';
import { parseDocument } from './utils/DocumentParser';
import { processTextToAudioBlob } from './utils/TTSProcessor';
import './index.css';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState<string>('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState<{current: number, total: number} | null>(null);
  
  const [provider, setProvider] = useState('edge-tts');
  const [voice, setVoice] = useState('es-MX-DaliaNeural');
  
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Nombre base del archivo original (sin extensión)
  const fileBaseName = file?.name.replace(/\.[^/.]+$/, '') || 'audio';

  // Estimación de duración: ~150 palabras/minuto para narración en español
  const wordCount = text ? text.split(/\s+/).filter(w => w.length > 0).length : 0;
  const estimatedMinutes = Math.ceil(wordCount / 150);
  const estimatedDisplay = estimatedMinutes < 1 
    ? 'Menos de 1 min' 
    : estimatedMinutes < 60 
      ? `~${estimatedMinutes} min` 
      : `~${Math.floor(estimatedMinutes / 60)}h ${estimatedMinutes % 60}min`;

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    setAudioUrl(null);
    if (newProvider === 'edge-tts') {
      setVoice('es-MX-DaliaNeural');
    } else {
      setVoice('es');
    }
  };

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
        }
      });
      
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
    } catch (err: any) {
      console.error(err);
      alert(`Error al generar audio: ${err.message || 'Error desconocido'}`);
    } finally {
      setIsConverting(false);
      setProgress(null);
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `${fileBaseName}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

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
        {/* Lado Izquierdo: Dropzone */}
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
                <Loader2 size={48} className="dropzone-icon" style={{ animation: 'spin 1s linear infinite' }} />
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

        {/* Lado Derecho: Configuración */}
        <div className="panel">
          <div className="panel-header">
            <Sparkles size={20} className="text-cyber-teal" />
            <span>Motor de Voz</span>
          </div>

          <div className="form-group">
            <label className="form-label text-cyber-teal flex-label">
              <Sparkles size={14} className="icon-subtle" />
              Proveedor Selectivo
            </label>
            <select className="form-select border-cyber" value={provider} onChange={e => handleProviderChange(e.target.value)}>
              <option value="edge-tts">Microsoft Azure Edge TTS (Neural Premium)</option>
              <option value="google">Google Translate TTS (Estándar)</option>
            </select>
          </div>

          <div className="form-group mt-2">
            <label className="form-label flex-label">
              <FileText size={14} className="icon-subtle" />
              Perfil de Voz
            </label>
            <select className="form-select" value={voice} onChange={e => setVoice(e.target.value)}>
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
              {provider === 'google' && (
                <>
                  <option value="es">Español (Latino)</option>
                  <option value="es-419">Español (Latinoamérica)</option>
                </>
              )}
            </select>
            <div className="provider-helper">
              {provider === 'edge-tts' && 'Integración directa con Microsoft Azure. Calidad Neural de estudio.'}
              {provider === 'google' && 'Motor genérico de Google Cloud. Alta claridad vocal.'}
            </div>
          </div>

          <div className="action-container">
            <button 
              className="btn btn-action flush-btn" 
              onClick={handleConvert}
              disabled={!file || text.length === 0 || isConverting || isExtracting}
            >
              {isConverting ? (
                <>
                  <Loader2 size={18} className="spinner" />
                  {progress ? `Sintetizando Bloque ${progress.current + 1}/${progress.total}` : 'Iniciando Procesamiento...'}
                </>
              ) : (
                <>
                  <Play size={18} />
                  Sintetizar Audio
                </>
              )}
            </button>
          </div>

          {audioUrl && (
            <div className="audio-console">
              <div className="panel-header borderless small-header text-cyber-teal">
                <Music size={16} />
                <span>Consola de Salida</span>
              </div>
              <div className="file-tag mb-3">{fileBaseName}.mp3</div>
              <audio controls src={audioUrl} className="cyber-audio" />
              <button className="btn btn-secondary w-full mt-3" onClick={handleDownload}>
                <Download size={18} />
                Descargar MP3 Exportado
              </button>
            </div>
          )}
        </div>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .text-cyber-teal { color: var(--cyber-teal); }
      `}} />
    </div>
  );
}

export default App;
