/**
 * Preprocesador Narrativo Inteligente
 * Analiza el texto crudo y lo transforma para que el motor TTS
 * respire naturalmente, insertando pausas en puntos lógicos.
 */

// Conjunciones y conectores del español donde es natural hacer una micro-pausa
const SPANISH_CONJUNCTIONS = [
  // Adversativas (contraste)
  ' pero ', ' sin embargo ', ' no obstante ', ' aunque ', ' sino ',
  // Causales
  ' porque ', ' ya que ', ' dado que ', ' puesto que ', ' debido a que ',
  // Consecutivas
  ' por lo tanto ', ' por consiguiente ', ' en consecuencia ', ' así que ', ' de modo que ',
  // Copulativas largas (solo cuando la oración ya es larga)
  ' y además ', ' y también ', ' e incluso ',
  // Condicionales
  ' si bien ', ' siempre que ', ' a menos que ', ' en caso de que ',
  // Temporales
  ' mientras que ', ' después de que ', ' antes de que ', ' cuando ',
  // Explicativas
  ' es decir ', ' o sea ', ' en otras palabras ', ' dicho de otro modo ',
  // Adiciones
  ' además ', ' asimismo ', ' igualmente ', ' por otra parte ', ' por otro lado ',
];

// Longitud máxima ideal de una "respiración" (en caracteres)
const MAX_BREATH_LENGTH = 120;

/**
 * Función principal: toma texto crudo y devuelve texto optimizado para narración.
 */
export function prepareTextForNarration(rawText: string): string {
  let text = rawText;

  // 1. Normalizar espacios en blanco múltiples
  text = text.replace(/[ \t]+/g, ' ');

  // 2. Asegurar pausas largas entre párrafos (doble salto de línea → pausa larga)
  text = text.replace(/\n\s*\n/g, '.\n\n');

  // 3. Limpiar puntos duplicados creados por el paso anterior
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(/\.\s*\./g, '.');

  // 4. Insertar comas de respiración en oraciones extremadamente largas
  text = insertBreathingCommas(text);

  // 5. Agregar micro-pausas después de dos puntos y punto y coma
  text = text.replace(/:\s*/g, ': ... ');
  text = text.replace(/;\s*/g, '; ');

  // 5.5. Convertir números romanos a arábigos para narración natural
  text = convertRomanNumerals(text);

  // 6. Asegurar que los números de lista tengan pausa
  text = text.replace(/(\d+)\.\s/g, '$1. ... ');

  // 7. Agregar pausas en viñetas y guiones de lista
  text = text.replace(/^[\-•]\s*/gm, '... ');

  // 7.5. Eliminar guiones bajos y guiones repetidos/aislados que la voz podría deletrear
  text = text.replace(/_+/g, ' '); // Todos los guiones bajos
  text = text.replace(/[-—–]{2,}/g, ' ... '); // Cadenas de múltiples guiones
  text = text.replace(/\s+[-—–]\s+/g, ' ... '); // Guiones aislados entre espacios

  // 8. Limpiar espacios excesivos finales
  text = text.replace(/\s{3,}/g, '  ');
  text = text.trim();

  return text;
}

/**
 * Analiza cada oración. Si supera MAX_BREATH_LENGTH caracteres,
 * busca conjunciones españolas donde insertar una coma natural.
 */
function insertBreathingCommas(text: string): string {
  // Dividir por oraciones (basado en punto final)
  const sentences = text.split(/(?<=[.!?])\s+/);
  const processed: string[] = [];

  for (const sentence of sentences) {
    if (sentence.length <= MAX_BREATH_LENGTH) {
      processed.push(sentence);
      continue;
    }

    // La oración es demasiado larga: buscar dónde insertar pausas
    let result = sentence;

    for (const conjunction of SPANISH_CONJUNCTIONS) {
      // Solo insertar coma si no hay ya una coma antes de la conjunción
      const pattern = new RegExp(`([^,])${escapeRegex(conjunction)}`, 'gi');
      result = result.replace(pattern, `$1,${conjunction}`);
    }

    // Si después de insertar comas en conjunciones aún hay segmentos largos,
    // buscar la conjunción "y" simple en segmentos > MAX_BREATH_LENGTH
    result = breakLongSegmentsAtY(result);

    processed.push(result);
  }

  return processed.join(' ');
}

/**
 * Para segmentos que siguen siendo muy largos, romper en la conjunción " y "
 */
function breakLongSegmentsAtY(text: string): string {
  const parts = text.split(',');
  const result: string[] = [];

  for (const part of parts) {
    if (part.length <= MAX_BREATH_LENGTH) {
      result.push(part);
      continue;
    }

    // Buscar " y " para insertar coma
    const yIndex = part.lastIndexOf(' y ');
    if (yIndex > 20 && yIndex < part.length - 20) {
      result.push(part.substring(0, yIndex) + ', y ' + part.substring(yIndex + 3));
    } else {
      result.push(part);
    }
  }

  return result.join(',');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════
// Conversión de Números Romanos a Arábigos
// ═══════════════════════════════════════════

// Prefijos legales/académicos que preceden números romanos con alta confianza
const ROMAN_PREFIXES = [
  'unidad', 'capítulo', 'capitulo', 'título', 'titulo',
  'sección', 'seccion', 'artículo', 'articulo', 'art\\.',
  'parágrafo', 'paragrafo', 'inciso', 'numeral',
  'cuadro', 'tabla', 'figura', 'libro', 'tomo',
  'volumen', 'parte', 'anexo', 'ley',
];

/**
 * Convierte un número romano a su equivalente arábigo.
 * Retorna null si no es un romano válido.
 */
function romanToArabic(roman: string): number | null {
  const values: Record<string, number> = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000
  };
  const upper = roman.toUpperCase();

  // Solo debe contener caracteres romanos válidos
  if (!/^[IVXLCDM]+$/i.test(upper)) return null;

  let result = 0;
  for (let i = 0; i < upper.length; i++) {
    const current = values[upper[i]];
    const next = values[upper[i + 1]] || 0;
    if (current < next) {
      result -= current; // Sustractivo: IV=4, IX=9, XL=40, etc.
    } else {
      result += current;
    }
  }

  if (result <= 0 || result > 3999) return null;
  return result;
}

/**
 * Reemplaza números romanos por arábigos en contextos seguros.
 * Estrategia A: Con prefijo conocido (alta confianza) — incluye romanos de 1+ carácter.
 * Estrategia B: Standalone con punto (confianza media) — solo romanos de 2+ caracteres.
 */
function convertRomanNumerals(text: string): string {
  let result = text;

  // Estrategia A: Prefijo conocido + número romano
  // Ejemplo: "UNIDAD IV", "art. 82.III", "parágrafo II"
  const prefixGroup = ROMAN_PREFIXES.join('|');
  const prefixPattern = new RegExp(
    `((?:${prefixGroup})\\s*\\.?)\\s*([IVXLCDM]{1,8})\\b`,
    'gi'
  );

  result = result.replace(prefixPattern, (_match, prefix: string, roman: string) => {
    const arabic = romanToArabic(roman);
    if (arabic !== null) {
      return `${prefix.trimEnd()} ${arabic}`;
    }
    return _match;
  });

  // Estrategia B: Standalone — romano de 2+ chars seguido de punto (inicio de sección)
  // Ejemplo: "VI. LA LEGISLACIÓN ELECTORAL"
  // Excluye letras sueltas (I., C., D.) para evitar falsos positivos
  result = result.replace(
    /(?<![a-zA-Z])([IVXLCDM]{2,8})\.(?=\s)/g,
    (_match, roman: string) => {
      const arabic = romanToArabic(roman);
      if (arabic !== null) {
        return `${arabic}.`;
      }
      return _match;
    }
  );

  // Estrategia C: Romano después de punto decimal en referencias legales
  // Ejemplo: "art. 82.III" → "art. 82.3"
  result = result.replace(
    /(\d)\.([IVXLCDM]{1,8})\b/g,
    (_match, digit: string, roman: string) => {
      const arabic = romanToArabic(roman);
      if (arabic !== null) {
        return `${digit}.${arabic}`;
      }
      return _match;
    }
  );

  // Estrategia D: Romano invertido (Número + Prefijo)
  // Ocurre frecuentemente en PDFs cuando el número está visualmente arriba de la palabra "Capítulo"
  // Ejemplo: "X Capítulo" → "Capítulo 10"
  const invertedPattern = new RegExp(
    `\\b([IVXLCDM]{1,8})\\s+((?:${prefixGroup})\\b)`,
    'gi'
  );

  result = result.replace(invertedPattern, (_match, roman: string, suffix: string) => {
    const arabic = romanToArabic(roman);
    if (arabic !== null) {
      // Normalizar la capitalización ("capítulo" -> "Capítulo")
      const suffixCapitalized = suffix.charAt(0).toUpperCase() + suffix.slice(1).toLowerCase();
      return `${suffixCapitalized} ${arabic}`;
    }
    return _match;
  });

  return result;
}
