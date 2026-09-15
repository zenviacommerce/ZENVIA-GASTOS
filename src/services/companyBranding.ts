import { supabase } from './supabase';

const BUCKET = 'company-assets';
const MAX_LOGO_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export type CompanyBranding = {
  ownerId: string;
  logoPath?: string | null;
  logoDataUrl?: string | null;
};

async function workspaceOwnerId() {
  const { data, error } = await supabase.from('business_settings').select('owner_id').maybeSingle();
  if (error) throw error;
  if (data?.owner_id) return data.owner_id as string;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user?.id) throw new Error('No se pudo identificar el espacio de trabajo.');
  return authData.user.id;
}

async function blobToPngDataUrl(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('No se pudo leer el logotipo.'));
      image.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar el logotipo.');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function loadCompanyBranding(): Promise<CompanyBranding> {
  const ownerId = await workspaceOwnerId();
  const { data, error } = await supabase.from('company_branding').select('logo_path').eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  const logoPath = data?.logo_path || null;
  if (!logoPath) return { ownerId, logoPath: null, logoDataUrl: null };

  const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(logoPath);
  if (downloadError) throw downloadError;
  const logoDataUrl = await blobToPngDataUrl(file);
  return { ownerId, logoPath, logoDataUrl };
}

export function validateCompanyLogo(file: File) {
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error('El logotipo debe ser PNG, JPG o WebP.');
  if (file.size > MAX_LOGO_SIZE) throw new Error('El logotipo no puede superar 5 MB.');
}

export async function uploadCompanyLogo(file: File, currentPath?: string | null): Promise<CompanyBranding> {
  validateCompanyLogo(file);
  const ownerId = await workspaceOwnerId();
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
  const logoPath = `${ownerId}/branding/logo-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(logoPath, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;

  const { error: saveError } = await supabase.from('company_branding').upsert({ owner_id: ownerId, logo_path: logoPath, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
  if (saveError) {
    await supabase.storage.from(BUCKET).remove([logoPath]);
    throw saveError;
  }

  if (currentPath && currentPath !== logoPath) await supabase.storage.from(BUCKET).remove([currentPath]);
  return loadCompanyBranding();
}

export async function removeCompanyLogo(currentPath?: string | null): Promise<CompanyBranding> {
  const ownerId = await workspaceOwnerId();
  const { error } = await supabase.from('company_branding').upsert({ owner_id: ownerId, logo_path: null, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
  if (error) throw error;
  if (currentPath) await supabase.storage.from(BUCKET).remove([currentPath]);
  return { ownerId, logoPath: null, logoDataUrl: null };
}
