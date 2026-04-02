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

  // 6. Asegurar que los números de lista tengan pausa
  text = text.replace(/(\d+)\.\s/g, '$1. ... ');

  // 7. Agregar pausas en viñetas y guiones de lista
  text = text.replace(/^[\-•]\s*/gm, '... ');

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
