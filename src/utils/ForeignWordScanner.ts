export const SPANISH_STOP_WORDS = new Set([
  'del', 'al', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'e', 'ni', 'o', 'u', 'pero', 'mas', 'sino',
  'a', 'ante', 'bajo', 'cabe', 'con', 'contra', 'de', 'desde',
  'durante', 'en', 'entre', 'hacia', 'hasta', 'mediante', 'para',
  'por', 'segun', 'sin', 'so', 'sobre', 'tras', 'versus', 'via',
  'que', 'porque', 'como', 'cuando', 'donde', 'quien', 'cual',
  'yo', 'tu', 'el', 'ella', 'nosotros', 'nosotras', 'vosotros',
  'ellos', 'ellas', 'me', 'te', 'se', 'nos', 'os', 'lo', 'la', 'le',
  'mi', 'tu', 'su', 'nuestro', 'vuestro', 'mis', 'tus', 'sus',
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'aquel', 'aquella', 'aquellos', 'aquellas', 'esto', 'eso', 'aquello',
  'ser', 'estar', 'tener', 'hacer', 'ir', 'poder', 'decir', 'ver',
  'es', 'son', 'era', 'eran', 'fui', 'fue', 'fueron', 'sea', 'sean',
  'hay', 'haber', 'habia', 'hubo', 'ha', 'han', 'he', 'hemos',
  'tiene', 'tienen', 'tenia', 'tenian', 'tuvo', 'tuvieron',
  'todo', 'toda', 'todos', 'todas', 'mucho', 'mucha', 'muchos', 'muchas',
  'poco', 'poca', 'pocos', 'pocas', 'mas', 'menos', 'muy', 'tan', 'tanto',
  'tambien', 'tampoco', 'siempre', 'nunca', 'jamas',
  'ahora', 'antes', 'despues', 'luego', 'ya', 'todavia', 'aun',
  'aqui', 'ahi', 'alli', 'alla', 'cerca', 'lejos',
  'bien', 'mal', 'mejor', 'peor',
  'si', 'no', 'tal', 'vez', 'asi',
  'articulo', 'ley', 'capitulo', 'unidad', 'seccion', 'paragrafo', 'inciso',
  'numero', 'estado', 'nacional', 'internacional', 'social', 'derecho',
  'desarrollo', 'sistema', 'educacion', 'superior', 'universidad', 'bolivia',
  'gobierno', 'politica', 'publico', 'privado', 'general', 'especial',
  'documento', 'informacion', 'proyecto', 'programa', 'objetivo', 'meta',
  'resultado', 'evaluacion', 'gestion', 'administracion', 'proceso', 'actividad',
  'texto', 'autor', 'pagina', 'libro', 'tomo', 'volumen', 'parte', 'titulo',
  'solo', 'suyos', 'suyas', 'cuales', 'quienes', 'quien', 'algun', 'alguna',
  'algunos', 'algunas', 'ningun', 'ninguna', 'ningunos', 'ningunas', 'varios',
  'varias', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'mismos', 'mismas',
  'cierto', 'cierta', 'ciertos', 'ciertas', 'propio', 'propia', 'propios', 'propias',
  'demas', 'tales', 'ambos', 'ambas', 'cada', 'cualquier', 'cualesquiera'
]);

export function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Patrones de caracteres raros en español pero comunes en inglés
const ENGLISH_PATTERNS = [
  /ing$/i, /tion$/i, /ment$/i, /ness$/i, /ship$/i, /ity$/i, /ful$/i,
  /oo/i, /ee/i, /ck/i, /sh/i, /ph/i, /th/i, /ght/i, /tch/i, /ll$/i,
  /^[A-Z][a-z]+[A-Z][a-z]+/ // PascalCase (ej: CoolHunting, YouTube)
];

export interface ScannedWord {
  word: string;
  isHighlyLikelyEnglish: boolean;
  count: number;
}

export function scanForForeignWords(text: string): ScannedWord[] {
  // Extraemos palabras usando letras españolas y latinas
  const words = text.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]+/g) || [];
  
  const frequencyMap = new Map<string, number>();
  
  for (const w of words) {
    if (w.length <= 3) continue; // Filtra siglas muy cortas y palabras conectoras omitidas
    
    const lowerClean = removeAccents(w.toLowerCase());
    
    if (SPANISH_STOP_WORDS.has(lowerClean)) continue;
    
    // Normalizamos para no separar "CoolHunting" de "coolhunting" a veces, pero priorizamos como venga.
    // Usamos la variante original. Si viene en mayúscula y minúscula, contamos a la primera que apareció.
    
    // Para no duplicar (ej: Marketing y marketing), guardamos con Key en minúscula pero mostramos original
    const existing = frequencyMap.get(w);
    if (existing) {
      frequencyMap.set(w, existing + 1);
    } else {
      frequencyMap.set(w, 1);
    }
  }

  // Deduplicamos "Marketing" vs "marketing" consolidando puntaje
  const consolidatedMap = new Map<string, { original: string, count: number }>();
  for (const [key, count] of frequencyMap.entries()) {
    const lowerKey = key.toLowerCase();
    const existing = consolidatedMap.get(lowerKey);
    if (existing) {
      // Si la que evaluamos empieza en mayúscula, preferir su formato original (ej. Marketing > marketing)
      const preferUpper = /^[A-Z]/.test(key) && !/^[A-Z]/.test(existing.original);
      consolidatedMap.set(lowerKey, {
        original: preferUpper ? key : existing.original,
        count: existing.count + count
      });
    } else {
      consolidatedMap.set(lowerKey, { original: key, count });
    }
  }

  const results: ScannedWord[] = [];
  for (const entry of consolidatedMap.values()) {
    const isHighlyLikelyEnglish = ENGLISH_PATTERNS.some(regex => regex.test(entry.original));
    results.push({ word: entry.original, isHighlyLikelyEnglish, count: entry.count });
  }

  return results.sort((a, b) => {
    // Primero si parece mucho inglés, luego por frecuencia de aparición
    if (a.isHighlyLikelyEnglish && !b.isHighlyLikelyEnglish) return -1;
    if (!a.isHighlyLikelyEnglish && b.isHighlyLikelyEnglish) return 1;
    return b.count - a.count;
  }).slice(0, 100); // Mostramos máx 100 candidatas
}
