const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

const legalSuffixPattern = '(?:S\\.?\\s*L\\.?\\s*U?\\.?|S\\.?\\s*A\\.?|SLU|SL|SA|C\\.?\\s*B\\.?|CB|LTD\\.?|LIMITED|GMBH|SAS|B\\.?\\s*V\\.?|BV|LLC|INC\\.?|PLC)';
const legalSuffixRegex = new RegExp(`\\b${legalSuffixPattern}(?=\\s|$|[,;:.])`, 'i');

/**
 * Limpia nombres de proveedor procedentes de OCR sin intentar hacer una
 * coincidencia difusa agresiva. El objetivo es quitar texto que claramente no
 * pertenece a la razón social (IBAN, NIF, teléfono, etc.).
 */
export function canonicalizeSupplierName(value: string): string {
  let result = compact(String(value || ''))
    .replace(/^(?:un\s+cordial\s+saludo|cordialmente|atentamente|saludos?|gracias)[,:;\s-]+/i, '')
    .replace(/^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/g, '')
    .trim();
  if (!result) return '';

  // Si la línea contiene una razón social y después datos fiscales/bancarios,
  // nos quedamos únicamente con la razón social.
  const legalMatch = result.match(new RegExp(`^(.{2,120}?\\b${legalSuffixPattern})(?=\\s|$|[,;:.])`, 'i'));
  if (legalMatch?.[1]) result = compact(legalMatch[1]);

  result = result
    .replace(/\s+(?:IBAN|BIC|SWIFT|NIF|CIF|VAT|IVA|TAX\s*ID|TEL(?:ÉFONO)?|TÉL(?:ÉFONO)?|PHONE|E-?MAIL|CORREO|BANCO|BANK|CUENTA\s+BANCARIA)\s*[:.\-]?.*$/i, '')
    .replace(/\s+(?:https?:\/\/|www\.).*$/i, '')
    .replace(/[\s:;,.\-–—]+$/g, '')
    .trim();

  return result.slice(0, 120);
}

export function supplierIdentityKey(value: string): string {
  return canonicalizeSupplierName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function supplierCoreKey(value: string): string {
  return supplierIdentityKey(value)
    .replace(/\s+(?:s\s*l\s*u|slu|s\s*l|sl|s\s*a|sa|c\s*b|cb|b\s*v|bv|ltd|limited|gmbh|sas|llc|inc|plc)$/i, '')
    .trim();
}

export function isLikelySameSupplier(a: string, b: string): boolean {
  const aKey = supplierIdentityKey(a);
  const bKey = supplierIdentityKey(b);
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;

  const aCore = supplierCoreKey(a);
  const bCore = supplierCoreKey(b);
  if (!aCore || !bCore || aCore !== bCore) return false;

  // Exigimos un nombre suficientemente descriptivo para no fusionar empresas
  // distintas que solo compartan una palabra corta.
  return aCore.length >= 8 && aCore.split(/\s+/).length >= 2;
}

/**
 * Busca una razón social explícita en cualquier línea, incluso si en la misma
 * línea aparecen NIF/VAT u otros datos. También soporta encabezados de dos líneas
 * como "EMISOR:" seguido por la razón social en la línea siguiente.
 */
export function extractExplicitLegalSupplier(lines: string[]): string {
  const labelOnly = /^(?:proveedor|supplier|emisor|raz[oó]n\s+social)\s*[:.\-]?\s*$/i;
  const inlineLabel = /^(?:proveedor|supplier|emisor|raz[oó]n\s+social)\s*[:.\-]\s*(.+)$/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = compact(lines[index]);
    if (!line) continue;

    const inline = line.match(inlineLabel)?.[1];
    if (inline) {
      const candidate = canonicalizeSupplierName(inline);
      if (candidate && !/zenvia\s+commerce/i.test(candidate) && candidate.length >= 4) return candidate;
    }

    if (labelOnly.test(line)) {
      for (let offset = 1; offset <= 3; offset += 1) {
        const next = canonicalizeSupplierName(lines[index + offset] || '');
        if (!next) continue;
        if (/zenvia\s+commerce/i.test(next)) break;
        if (/^(?:cliente|customer|interesado|destinatario|nif|cif|vat|direcci[oó]n)\b/i.test(next)) break;
        if (next.length >= 4) return next;
      }
    }
  }

  for (const raw of lines) {
    const line = compact(raw);
    if (line.length < 4 || line.length > 180) continue;
    if (/zenvia\s+commerce/i.test(line)) continue;
    if (!legalSuffixRegex.test(line)) continue;

    const candidate = canonicalizeSupplierName(line);
    if (!candidate || /^(?:factura|invoice|cliente|customer)\b/i.test(candidate)) continue;
    if (candidate.length < 4) continue;
    return candidate;
  }
  return '';
}
