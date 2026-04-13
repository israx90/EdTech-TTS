import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Workaround for Vite to load pdfjs worker
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ParseOptions {
  removeExtraneousText?: boolean;
}

export async function parseDocument(file: File, options: ParseOptions = { removeExtraneousText: true }): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'txt':
      return await file.text();
      
    case 'docx':
      return await parseDocx(file);
      
    case 'pdf':
      return await parsePdf(file, options);
      
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value;
  
  // Reemplazar tablas con placeholders verbales para TTS
  return processHtmlWithTablePlaceholders(html, file.name);
}

// Patrón para detectar títulos de tablas/cuadros/figuras
const TABLE_TITLE_PATTERN = /cuadro|tabla|table|figura|figure/i;

/**
 * Procesa HTML de mammoth: reemplaza <table> con placeholders verbales
 * que indican al oyente consultar el documento original.
 */
function processHtmlWithTablePlaceholders(html: string, fileName: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  let tableCounter = 0;
  const tables = doc.querySelectorAll('table');
  
  tables.forEach(table => {
    tableCounter++;
    const { title, titleElement } = extractTableTitle(table, tableCounter);
    
    // Crear placeholder verbal
    const placeholder = doc.createElement('p');
    placeholder.textContent = `Por favor revisa la tabla "${title}" del Documento "${fileName}".`;
    
    // Reemplazar la tabla con el placeholder
    table.parentNode?.replaceChild(placeholder, table);
    
    // Eliminar el párrafo-título huérfano que precedía a la tabla
    if (titleElement && titleElement.parentNode) {
      titleElement.parentNode.removeChild(titleElement);
    }
    
    // Eliminar captions post-tabla (notas al pie tipo "a Se indica artículo(s)..." o "D = diputados...")
    let next = placeholder.nextElementSibling;
    while (next) {
      const nextText = (next.textContent || '').trim();
      // Captions son párrafos cortos que comienzan con letra minúscula + espacio, o MAYÚSCULA = ...
      if (nextText.length < 200 && (/^[a-z]\s/.test(nextText) || /^[A-Z]\s*=/.test(nextText))) {
        const toRemove = next;
        next = next.nextElementSibling;
        toRemove.parentNode?.removeChild(toRemove);
      } else {
        break;
      }
    }
  });
  
  if (tableCounter > 0) {
    console.log(`📄 DOCX: ${tableCounter} tabla(s) reemplazada(s) con placeholders verbales`);
  }
  
  // Extraer texto limpio del HTML modificado
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extrae el título de una tabla buscando en dos ubicaciones:
 * A) Dentro de la primera celda de la tabla
 * B) En el elemento hermano anterior (párrafo previo)
 */
function extractTableTitle(table: Element, fallbackIndex: number): { title: string, titleElement: Element | null } {
  // Estrategia A: Título en alguna celda de la primera fila de la tabla
  const firstRow = table.querySelector('tr');
  if (firstRow) {
    const cells = firstRow.querySelectorAll('td, th');
    for (const cell of cells) {
      const cellText = (cell.textContent || '').trim();
      if (cellText && TABLE_TITLE_PATTERN.test(cellText)) {
        return { title: cellText, titleElement: null };
      }
    }
  }
  
  // Estrategia B: Título en el párrafo anterior a la tabla
  let prev = table.previousElementSibling;
  let stepsBack = 0;
  while (prev && stepsBack < 3) {
    const prevText = (prev.textContent || '').trim();
    if (TABLE_TITLE_PATTERN.test(prevText)) {
      return { title: prevText, titleElement: prev };
    }
    prev = prev.previousElementSibling;
    stepsBack++;
  }
  
  // Fallback: nombre genérico
  return { title: `Tabla ${fallbackIndex}`, titleElement: null };
}

// Patrones de numeración de página que debemos eliminar
const PAGE_NUMBER_PATTERNS = [
  /^\s*\d{1,4}\s*$/,                          // Solo un número: "1", "  23  "
  /^\s*-\s*\d{1,4}\s*-\s*$/,                  // Guionado: "- 5 -"
  /^\s*[–—]\s*\d{1,4}\s*[–—]\s*$/,           // Dashes: "– 5 –"
  /^\s*•\s*\d{1,4}\s*•\s*$/,                  // Bullets: "• 17 •"
  /^\s*página\s+\d+/i,                        // "Página 12"
  /^\s*page\s+\d+/i,                          // "Page 12"
  /^\s*pág\.?\s*\d+/i,                        // "Pág. 12"
  /^\s*p\.\s*\d+/i,                           // "p. 12"
  /^\s*\d+\s*de\s*\d+\s*$/i,                  // "3 de 15"
  /^\s*\d+\s*\/\s*\d+\s*$/,                   // "3/15"
];

interface TextItem {
  str: string;
  y: number;
  height: number;
}

async function parsePdf(file: File, options: ParseOptions): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  // Fase 1: Extraer texto con posiciones Y de cada página
  const allPagesData: { items: TextItem[], pageHeight: number }[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    
    const items: TextItem[] = textContent.items
      .filter((item: any) => item.str && item.str.trim().length > 0)
      .map((item: any) => ({
        str: item.str,
        y: item.transform ? item.transform[5] : 0,
        height: item.height || 12
      }));
    
    allPagesData.push({ items, pageHeight: viewport.height });
  }

  // Fase 1.5: Detectar y omitir páginas de carátula
  const pagesData = options.removeExtraneousText !== false
    ? allPagesData.filter((pageData, idx) => !isCoverPage(pageData.items, idx))
    : allPagesData;
  const skippedCovers = allPagesData.length - pagesData.length;
  if (skippedCovers > 0) {
    console.log(`📄 PDF: ${skippedCovers} carátula(s) omitida(s)`);
  }

  // Fase 2: Detectar encabezados/pies repetidos por posición Y (con normalización fuzzy)
  const headerThreshold = 0.85; // Top 15% = header zone
  const footerThreshold = 0.15; // Bottom 15% = footer zone

  const headerTexts = new Map<string, number>();
  const footerTexts = new Map<string, number>();

  for (const pageData of pagesData) {
    const { items, pageHeight } = pageData;
    
    for (const item of items) {
      const relativeY = item.y / pageHeight;
      const normalized = normalizeForComparison(item.str);
      
      if (normalized.length === 0) continue;
      
      if (relativeY >= headerThreshold) {
        headerTexts.set(normalized, (headerTexts.get(normalized) || 0) + 1);
      }
      if (relativeY <= footerThreshold) {
        footerTexts.set(normalized, (footerTexts.get(normalized) || 0) + 1);
      }
    }
  }

  // Un texto es header/footer si aparece en >= 30% de las páginas de contenido (mínimo 2)
  const minRepetitions = Math.max(2, Math.floor(pagesData.length * 0.3));
  const repeatedHeaders = new Set<string>();
  const repeatedFooters = new Set<string>();

  for (const [text, count] of headerTexts) {
    if (count >= minRepetitions) repeatedHeaders.add(text);
  }
  for (const [text, count] of footerTexts) {
    if (count >= minRepetitions) repeatedFooters.add(text);
  }

  console.log(`📄 PDF: ${pdf.numPages} páginas (${pagesData.length} de contenido) | Headers detectados: ${repeatedHeaders.size} | Footers: ${repeatedFooters.size}`);

  // Fase 3: Reconstruir texto limpio
  const cleanPages: string[] = [];

  for (const pageData of pagesData) {
    const { items, pageHeight } = pageData;
    const lines = groupItemsByLine(items);
    const pageLines: { text: string, relativeY: number }[] = [];

    for (const line of lines) {
      const lineText = line.text.trim();
      if (!lineText) continue;

      const relativeY = line.y / pageHeight;
      const normalized = normalizeForComparison(lineText);

      // Filtro 1: Encabezado/pie repetido (comparación fuzzy)
      // * Solo si el usuario quiere remover texto extraño
      if (options.removeExtraneousText !== false) {
        if (relativeY >= headerThreshold && repeatedHeaders.has(normalized)) continue;
        if (relativeY <= footerThreshold && repeatedFooters.has(normalized)) continue;

        // Filtro 2: Número de página
        if (isPageNumber(lineText)) continue;

        // Filtro 3: Texto muy corto en zona header/footer (cubre siglas institucionales)
        if ((relativeY >= headerThreshold || relativeY <= footerThreshold) && lineText.length <= 10) continue;
      }

      pageLines.push({ text: lineText, relativeY });
    }

    // Filtro 4: Acuchillado de notas bibliográficas en bloque
    // * Solo si el usuario quiere remover texto extraño
    if (options.removeExtraneousText !== false) {
      const bottomStartIndex = pageLines.findIndex(l => l.relativeY <= 0.40);

    if (bottomStartIndex !== -1) {
      let anchorIndex = -1;
      
      // Buscar la primera línea en la zona inferior que ES inconfundiblemente bibliografía
      for (let i = bottomStartIndex; i < pageLines.length; i++) {
        if (getBibliographicScore(pageLines[i].text) >= 2) {
          anchorIndex = i;
          break;
        }
      }

      if (anchorIndex !== -1) {
        // Encontramos una línea fuertemente bibliográfica. 
        // Ahora caminamos hacia atrás (hacia arriba) para hallar el VERDADERO inicio de la cita.
        // Frecuentemente la 1ra línea ("1 D' AVIS") tiene poco score, pero la 2da ("Edit. Leyes, 1980") tiene mucho.
        let cutIndex = anchorIndex;
        
        for (let j = anchorIndex - 1; j >= Math.max(bottomStartIndex, anchorIndex - 4); j--) {
          const text = pageLines[j].text;
          // Si la línea superior inicia con número de pie de página (ej. "1 Nombre"), guiones, o mayúsculas formales
          if (/^\s*(\d+|[_]{2,}|[-]{3,})\s*/.test(text) || /^\s*[A-ZÁÉÍÓÚÑ]{4,}/.test(text)) {
            cutIndex = j;
            break; // Encontramos el inicio real
          }
        }

        // Cortar absolutamente todo desde cutIndex hacia abajo
        pageLines.splice(cutIndex);
      }
    }
    }
    // (Fin Filtro 4)

    if (pageLines.length > 0) {
      let pageText = '';
      for (let i = 0; i < pageLines.length; i++) {
        const line = pageLines[i].text;
        pageText += line;
        
        // Inyectar puntuación si parece un título o fin de párrafo aislado
        const isShort = line.length <= 85;
        const endsWithPunctuation = /[.:;?!,"')\]]$/.test(line.trim());
        const isNextLineCapitalized = i + 1 < pageLines.length && /^[A-ZÁÉÍÓÚÑ¿¡1-9]/.test(pageLines[i+1].text.trim());

        if (isShort && !endsWithPunctuation && isNextLineCapitalized) {
          pageText += '. ';
        } else {
          pageText += ' ';
        }
      }
      cleanPages.push(pageText.trim());
    }
  }

  return cleanPages.join('\n\n');
}

/**
 * Agrupa items de texto en líneas basándose en su posición Y
 */
function groupItemsByLine(items: TextItem[]): { text: string, y: number }[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y);
  
  const lines: { text: string, y: number }[] = [];
  let currentLine = sorted[0].str;
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(currentY - item.y) < (item.height || 12) * 0.8) {
      currentLine += ' ' + item.str;
    } else {
      lines.push({ text: currentLine, y: currentY });
      currentLine = item.str;
      currentY = item.y;
    }
  }
  lines.push({ text: currentLine, y: currentY });

  return lines;
}

/**
 * Detecta si una línea es un número de página
 */
function isPageNumber(text: string): boolean {
  return PAGE_NUMBER_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Evalúa líneas para detectar peso de nota al pie bibliográfica
 */
function getBibliographicScore(text: string): number {
  let score = 0;
  if (/ob\.?\s*cit\.?/i.test(text)) score += 2;
  if (/\b(pág[s]?\.?|ps\.?)\b/i.test(text)) score += 1;
  if (/\b[E]dit\.?/i.test(text) || /edición/i.test(text)) score += 1;
  if (/\b(19|20)\d{2}\b/.test(text)) score += 1;
  
  const caps = text.match(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/g);
  if (caps && caps.length >= 2) score += 1;
  
  return score;
}

/**
 * Normaliza texto para comparación fuzzy de headers/footers.
 * Reemplaza dígitos con '#' y elimina diacríticos/acentos para ser altamente agresivo con OCR.
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Elimina acentos ("Martínez" -> "martinez")
    .replace(/\s+/g, ' ') // Normaliza espacios dobles
    .replace(/\d/g, '#')
    .trim();
}

/**
 * Detecta si una página es una carátula/portada que debe omitirse.
 * Heurística: muy poco texto, pocas líneas, o primera página sin oraciones completas.
 */
function isCoverPage(items: TextItem[], pageIndex: number): boolean {
  // Solo las primeras 2 páginas pueden ser carátula
  if (pageIndex > 1) return false;

  const totalText = items.map(i => i.str).join(' ').trim();
  const lines = groupItemsByLine(items);
  const lineCount = lines.length;

  // Si tiene muchísimo texto, seguro no es una carátula normal
  if (totalText.length > 600) return false;

  // Muy poco texto (menos de 150 chars) = carátula o página vacía/puramente gráfica
  if (totalText.length < 150) return true;

  // Muy pocas líneas = portada tipográfica
  if (lineCount < 4) return true;

  // Primera página sin oraciones completas (sin puntos evaluando 10 líneas) = portada
  if (pageIndex === 0) {
    const firstLines = lines.slice(0, 10).map(l => l.text).join(' ');
    if (!firstLines.includes('.')) return true;
  }

  return false;
}
