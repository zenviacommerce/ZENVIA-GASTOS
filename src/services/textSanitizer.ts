function isUnicodeNonCharacter(codePoint: number) {
  return (codePoint >= 0xFDD0 && codePoint <= 0xFDEF)
    || (codePoint >= 0 && (codePoint & 0xFFFF) === 0xFFFE)
    || (codePoint >= 0 && (codePoint & 0xFFFF) === 0xFFFF);
}

/**
 * Removes characters that cannot safely round-trip through JSON/PostgREST/Postgres text.
 * Keeps normal whitespace (tabs/newlines) so OCR/PDF text remains readable.
 */
export function sanitizeDatabaseText(value: string | null | undefined) {
  const source = String(value ?? '');
  let output = '';

  for (let index = 0; index < source.length; index += 1) {
    const first = source.charCodeAt(index);

    // NUL and C0/C1 control characters are unsafe in Postgres JSON/text payloads.
    if (first === 0) continue;
    if ((first >= 0x01 && first <= 0x08)
      || first === 0x0B
      || first === 0x0C
      || (first >= 0x0E && first <= 0x1F)
      || (first >= 0x7F && first <= 0x9F)) {
      output += ' ';
      continue;
    }

    // Drop lone surrogates and Unicode noncharacters such as U+FFFE/U+FFFF.
    if (first >= 0xD800 && first <= 0xDBFF) {
      const second = source.charCodeAt(index + 1);
      if (second >= 0xDC00 && second <= 0xDFFF) {
        const codePoint = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00);
        if (!isUnicodeNonCharacter(codePoint)) output += source[index] + source[index + 1];
        index += 1;
      }
      continue;
    }
    if (first >= 0xDC00 && first <= 0xDFFF) continue;
    if (isUnicodeNonCharacter(first)) continue;

    output += source[index];
  }

  return output.normalize('NFC');
}

export function sanitizeDatabaseSingleLine(value: string | null | undefined) {
  return sanitizeDatabaseText(value).replace(/\s+/g, ' ').trim();
}

export function sanitizeDatabaseValue<T>(value: T): T {
  if (typeof value === 'string') return sanitizeDatabaseText(value) as unknown as T;
  if (Array.isArray(value)) return value.map(item => sanitizeDatabaseValue(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const cleaned = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, sanitizeDatabaseValue(item)]),
    );
    return cleaned as unknown as T;
  }
  return value;
}
