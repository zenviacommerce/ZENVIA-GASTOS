import { jsPDF } from 'jspdf';

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export async function imageFilesToPdf(files: File[]): Promise<File> {
  if (!files.length) throw new Error('No hay imágenes.');
  let pdf: jsPDF | null = null;

  for (let index = 0; index < files.length; index += 1) {
    const dataUrl = await readAsDataUrl(files[index]);
    const img = await loadImage(dataUrl);
    const orientation = img.width >= img.height ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    else pdf.addPage('a4', orientation);

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageW / img.width, pageH / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    pdf.addImage(dataUrl, files[index].type === 'image/png' ? 'PNG' : 'JPEG', (pageW - w) / 2, (pageH - h) / 2, w, h, undefined, 'FAST');
  }

  const blob = pdf!.output('blob');
  return new File([blob], `factura-camara-${Date.now()}.pdf`, { type: 'application/pdf' });
}
