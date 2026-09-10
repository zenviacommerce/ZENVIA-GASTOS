const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function emailError(value: string, required = false): string {
  const clean = normalizeEmail(value);
  if (!clean) return required ? 'El email es obligatorio.' : '';
  if (clean.length > 254 || !EMAIL_RE.test(clean)) return 'Introduce un email válido, por ejemplo nombre@empresa.com.';
  return '';
}

export function normalizePhone(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function phoneError(value: string, required = false): string {
  const clean = normalizePhone(value);
  if (!clean) return required ? 'El teléfono es obligatorio.' : '';
  if (!/^[+()\d\s.-]+$/.test(clean)) return 'El teléfono contiene caracteres no válidos.';
  const digits = clean.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return 'El teléfono debe contener entre 7 y 15 dígitos.';
  return '';
}

export function normalizeTaxId(value: string) {
  return value.toUpperCase().replace(/[\s.-]/g, '').trim();
}

export function taxIdError(value: string, required = false): string {
  const clean = normalizeTaxId(value);
  if (!clean) return required ? 'El NIF/CIF es obligatorio.' : '';

  // España: DNI, NIE y NIF/CIF de persona jurídica. Para proveedores UE
  // también permitimos VAT IDs con prefijo de país y longitud razonable.
  const dni = /^\d{8}[A-Z]$/;
  const nie = /^[XYZ]\d{7}[A-Z]$/;
  const spanishCompany = /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/;
  const euVat = /^[A-Z]{2}[A-Z0-9]{6,12}$/;

  if (!dni.test(clean) && !nie.test(clean) && !spanishCompany.test(clean) && !euVat.test(clean)) {
    return 'Formato no válido. Usa un DNI/NIE/CIF/NIF o VAT europeo reconocible.';
  }
  return '';
}

export function nameError(value: string, label = 'El nombre') {
  const clean = value.trim();
  if (clean.length < 2) return `${label} debe tener al menos 2 caracteres.`;
  if (clean.length > 150) return `${label} es demasiado largo.`;
  return '';
}
