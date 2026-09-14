const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const TOKEN_KEY = 'zenvia-gmail-send-access';
const REFRESH_BUFFER_MS = 5 * 60_000;

declare global { interface Window { google?: any } }

type SendConnection={accessToken:string;expiresAt:number};

function loadGoogleIdentityServices(){
  if(window.google?.accounts?.oauth2)return Promise.resolve();
  return new Promise<void>((resolve,reject)=>{
    const existing=document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if(existing){existing.addEventListener('load',()=>resolve(),{once:true});existing.addEventListener('error',()=>reject(new Error('No se pudo cargar Google Identity Services.')),{once:true});return;}
    const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;script.dataset.googleIdentity='true';script.onload=()=>resolve();script.onerror=()=>reject(new Error('No se pudo cargar Google Identity Services.'));document.head.appendChild(script);
  });
}

function cachedConnection():SendConnection|null{
  try{const raw=sessionStorage.getItem(TOKEN_KEY);if(!raw)return null;const parsed=JSON.parse(raw) as SendConnection;if(!parsed.accessToken||parsed.expiresAt<=Date.now()+REFRESH_BUFFER_MS){sessionStorage.removeItem(TOKEN_KEY);return null;}return parsed;}catch{sessionStorage.removeItem(TOKEN_KEY);return null;}
}

async function connectForSend():Promise<SendConnection>{
  await loadGoogleIdentityServices();
  if(!GOOGLE_CLIENT_ID)throw new Error('Falta configurar VITE_GOOGLE_CLIENT_ID en Vercel.');
  return new Promise((resolve,reject)=>{
    const client=window.google.accounts.oauth2.initTokenClient({
      client_id:GOOGLE_CLIENT_ID,
      scope:GMAIL_SEND_SCOPE,
      callback:(response:any)=>{
        if(response?.error||!response?.access_token){reject(new Error(response?.error_description||response?.error||'Google no concedió permiso para enviar correos.'));return;}
        const connection:SendConnection={accessToken:response.access_token,expiresAt:Date.now()+Number(response.expires_in||3600)*1000};
        sessionStorage.setItem(TOKEN_KEY,JSON.stringify(connection));resolve(connection);
      },
      error_callback:(error:any)=>reject(new Error(error?.message||'No se pudo abrir la autorización de Google.')),
    });
    client.requestAccessToken({prompt:'consent'});
  });
}

async function ensureConnection(){return cachedConnection()||connectForSend();}

function utf8Base64(value:string){
  const bytes=new TextEncoder().encode(value);let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary);
}
function bytesBase64(bytes:Uint8Array){let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary);}
function base64UrlFromUtf8(value:string){return utf8Base64(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function encodedHeader(value:string){return `=?UTF-8?B?${utf8Base64(value)}?=`;}

export async function sendInvoiceViaGmail(input:{to:string;subject:string;body:string;pdf:Blob;filename:string}){
  const connection=await ensureConnection();
  const pdfBytes=new Uint8Array(await input.pdf.arrayBuffer());
  const boundary=`zenvia_${crypto.randomUUID().replace(/-/g,'')}`;
  const mime=[
    `To: ${input.to}`,
    `Subject: ${encodedHeader(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${input.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${input.filename}"`,
    '',
    bytesBase64(pdfBytes).replace(/(.{76})/g,'$1\r\n'),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
    method:'POST',headers:{Authorization:`Bearer ${connection.accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({raw:base64UrlFromUtf8(mime)}),
  });
  if(response.status===401||response.status===403){sessionStorage.removeItem(TOKEN_KEY);const text=await response.text();throw new Error(`Gmail no autorizó el envío. Vuelve a intentarlo para renovar el permiso. ${text.slice(0,180)}`);}
  if(!response.ok){const text=await response.text();throw new Error(`Gmail no pudo enviar la factura (${response.status}). ${text.slice(0,180)}`);}
  return response.json() as Promise<{id:string;threadId?:string}>;
}
