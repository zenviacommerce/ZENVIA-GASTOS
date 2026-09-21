import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ShippingSettings } from './settingsSchema';

pdfjsLib.GlobalWorkerOptions.workerSrc=pdfWorker;

type LabelLayout=Pick<ShippingSettings,'labelSize'|'labelOrientation'|'copies'>;

const PAGE_MM:Record<ShippingSettings['labelSize'],[number,number]>={
  A4:[210,297],
  A6:[105,148],
  '10x15':[100,150],
};

function targetDimensions(layout:LabelLayout){
  const [width,height]=PAGE_MM[layout.labelSize];
  return layout.labelOrientation==='landscape'?[height,width] as const:[width,height] as const;
}

async function renderPdfPage(page:any){
  const viewport=page.getViewport({scale:2.5});
  const canvas=document.createElement('canvas');
  const context=canvas.getContext('2d');
  if(!context)throw new Error('No se pudo preparar el PDF de la etiqueta.');
  canvas.width=Math.max(1,Math.ceil(viewport.width));
  canvas.height=Math.max(1,Math.ceil(viewport.height));
  await page.render({canvasContext:context,viewport}).promise;
  return {dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
}

export async function prepareLabelPdf(blob:Blob,layout:LabelLayout):Promise<Blob>{
  const copies=Math.max(1,Math.min(20,Math.round(layout.copies||1)));
  if(layout.labelSize==='A6'&&layout.labelOrientation==='portrait'&&copies===1)return blob;

  const bytes=await blob.arrayBuffer();
  const source=await pdfjsLib.getDocument({data:bytes}).promise;
  const [pageWidth,pageHeight]=targetDimensions(layout);
  const document=new jsPDF({unit:'mm',format:[pageWidth,pageHeight],orientation:'portrait',compress:true});
  let firstOutput=true;

  for(let pageIndex=1;pageIndex<=source.numPages;pageIndex+=1){
    const page=await source.getPage(pageIndex);
    const rendered=await renderPdfPage(page);
    const ratio=Math.min(pageWidth/rendered.width,pageHeight/rendered.height);
    const drawWidth=rendered.width*ratio;
    const drawHeight=rendered.height*ratio;
    const x=(pageWidth-drawWidth)/2;
    const y=(pageHeight-drawHeight)/2;

    for(let copy=0;copy<copies;copy+=1){
      if(firstOutput)firstOutput=false;
      else document.addPage([pageWidth,pageHeight],'portrait');
      document.addImage(rendered.dataUrl,'PNG',x,y,drawWidth,drawHeight,undefined,'FAST');
    }
    page.cleanup?.();
  }

  source.cleanup?.();
  source.destroy?.();
  return document.output('blob');
}
