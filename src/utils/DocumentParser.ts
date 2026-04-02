import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Workaround for Vite to load pdfjs worker
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function parseDocument(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'txt':
      return await file.text();
      
    case 'docx':
      return await parseDocx(file);
      
    case 'pdf':
      return await parsePdf(file);
      
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// Patrones de numeración de página que debemos eliminar
const PAGE_NUMBER_PATTERNS = [
  /^\s*\d{1,4}\s*$/,                          // Solo un número: "1", "  23  "
  /^\s*-\s*\d{1,4}\s*-\s*$/,                  // Guionado: "- 5 -"
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

async function parsePdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  // Fase 1: Extraer texto con posiciones Y de cada página
  const pagesData: { items: TextItem[], pageHeight: number }[] = [];
  
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
    
    pagesData.push({ items, pageHeight: viewport.height });
  }

  // Fase 2: Detectar encabezados/pies repetidos por posición Y
  const headerThreshold = 0.92; // Top 8% = header zone
  const footerThreshold = 0.08; // Bottom 8% = footer zone

  const headerTexts = new Map<string, number>();
  const footerTexts = new Map<string, number>();

  for (const pageData of pagesData) {
    const { items, pageHeight } = pageData;
    
    for (const item of items) {
      const relativeY = item.y / pageHeight;
      const normalized = item.str.trim().toLowerCase();
      
      if (normalized.length === 0) continue;
      
      if (relativeY >= headerThreshold) {
        headerTexts.set(normalized, (headerTexts.get(normalized) || 0) + 1);
      }
      if (relativeY <= footerThreshold) {
        footerTexts.set(normalized, (footerTexts.get(normalized) || 0) + 1);
      }
    }
  }

  // Un texto es header/footer si aparece en >= 50% de las páginas (mínimo 2)
  const minRepetitions = Math.max(2, Math.floor(pdf.numPages * 0.5));
  const repeatedHeaders = new Set<string>();
  const repeatedFooters = new Set<string>();

  for (const [text, count] of headerTexts) {
    if (count >= minRepetitions) repeatedHeaders.add(text);
  }
  for (const [text, count] of footerTexts) {
    if (count >= minRepetitions) repeatedFooters.add(text);
  }

  console.log(`📄 PDF: ${pdf.numPages} páginas | Headers detectados: ${repeatedHeaders.size} | Footers: ${repeatedFooters.size}`);

  // Fase 3: Reconstruir texto limpio
  const cleanPages: string[] = [];

  for (const pageData of pagesData) {
    const { items, pageHeight } = pageData;
    const lines = groupItemsByLine(items);
    const pageLines: string[] = [];

    for (const line of lines) {
      const lineText = line.text.trim();
      if (!lineText) continue;

      const relativeY = line.y / pageHeight;
      const normalized = lineText.toLowerCase();

      // Filtro 1: Encabezado/pie repetido
      if (relativeY >= headerThreshold && repeatedHeaders.has(normalized)) continue;
      if (relativeY <= footerThreshold && repeatedFooters.has(normalized)) continue;

      // Filtro 2: Número de página
      if (isPageNumber(lineText)) continue;

      // Filtro 3: Texto muy corto en zona header/footer
      if ((relativeY >= headerThreshold || relativeY <= footerThreshold) && lineText.length <= 5) continue;

      pageLines.push(lineText);
    }

    if (pageLines.length > 0) {
      cleanPages.push(pageLines.join(' '));
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
