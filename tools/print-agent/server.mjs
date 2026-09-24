import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDefaultPrinter, getPrinters, print } from 'pdf-to-printer';

const HOST=process.env.ZENVIA_PRINT_HOST||'127.0.0.1';
const PORT=Number(process.env.ZENVIA_PRINT_PORT||17931);
const VERSION='0.1.0';
const DEFAULT_ORIGINS=[
  'https://gestion.zenviacommerce.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const configured=(process.env.ZENVIA_PRINT_ALLOWED_ORIGINS||'')
  .split(',')
  .map(value=>value.trim())
  .filter(Boolean);
const allowedOrigins=new Set([...DEFAULT_ORIGINS,...configured]);

function vercelPreview(origin){
  try{
    const url=new URL(origin);
    return url.protocol==='https:'&&/\.vercel\.app$/i.test(url.hostname);
  }catch{return false}
}
function originAllowed(origin){
  return !origin||allowedOrigins.has(origin)||vercelPreview(origin);
}
function cors(req){
  const origin=req.headers.origin||'';
  const allow=originAllowed(origin)?(origin||'*'):'null';
  return {
    'Access-Control-Allow-Origin':allow,
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,X-Zenvia-Client,X-Printer-Id',
    'Access-Control-Allow-Private-Network':'true',
    'Access-Control-Max-Age':'86400',
    'Vary':'Origin',
  };
}
function json(req,res,status,payload){
  res.writeHead(status,{...cors(req),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}
async function body(req,max=25*1024*1024){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>max)throw new Error('El PDF supera el tamaño máximo permitido por el agente.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function printerList(){
  const [printers,defaultPrinter]=await Promise.all([getPrinters(),getDefaultPrinter()]);
  const defaultName=defaultPrinter?.name||'';
  const defaultId=defaultPrinter?.deviceId||'';
  return printers.map(item=>({
    id:item.deviceId||item.name,
    name:item.name,
    default:Boolean((defaultId&&item.deviceId===defaultId)||(defaultName&&item.name===defaultName)),
    paperSizes:Array.isArray(item.paperSizes)?item.paperSizes:[],
  }));
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){
    if(!originAllowed(req.headers.origin||'')){res.writeHead(403,cors(req));res.end();return}
    res.writeHead(204,cors(req));res.end();return;
  }
  if(!originAllowed(req.headers.origin||'')){json(req,res,403,{error:'Origen no permitido.'});return}

  const url=new URL(req.url||'/',`http://${HOST}:${PORT}`);
  try{
    if(req.method==='GET'&&url.pathname==='/health'){
      json(req,res,200,{ok:true,name:'ZENVIA Print Agent',version:VERSION,platform:process.platform});
      return;
    }
    if(req.method==='GET'&&url.pathname==='/printers'){
      json(req,res,200,{ok:true,printers:await printerList()});
      return;
    }
    if(req.method==='POST'&&url.pathname==='/print'){
      const printerId=String(req.headers['x-printer-id']||url.searchParams.get('printerId')||'').trim();
      if(!printerId){json(req,res,400,{error:'Falta indicar la impresora.'});return}
      const printers=await printerList();
      const selected=printers.find(item=>item.id===printerId||item.name===printerId);
      if(!selected){json(req,res,404,{error:'La impresora seleccionada ya no está disponible.'});return}
      const pdf=await body(req);
      if(pdf.length<5||pdf.subarray(0,5).toString('ascii')!=='%PDF-'){
        json(req,res,400,{error:'El documento recibido no es un PDF válido.'});return;
      }
      const dir=await mkdtemp(path.join(os.tmpdir(),'zenvia-print-'));
      const file=path.join(dir,`label-${Date.now()}.pdf`);
      try{
        await writeFile(file,pdf);
        await print(file,{printer:selected.name,silent:true,scale:'noscale'});
      }finally{
        await rm(dir,{recursive:true,force:true}).catch(()=>undefined);
      }
      json(req,res,200,{ok:true,printer:{id:selected.id,name:selected.name}});
      return;
    }
    json(req,res,404,{error:'Ruta no encontrada.'});
  }catch(error){
    json(req,res,500,{error:error instanceof Error?error.message:String(error)});
  }
});

server.listen(PORT,HOST,()=>{
  process.stdout.write(`ZENVIA Print Agent ${VERSION} listo en http://${HOST}:${PORT}\n`);
});
