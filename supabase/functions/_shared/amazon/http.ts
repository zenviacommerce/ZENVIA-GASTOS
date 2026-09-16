export function sanitizeAmazonError(value:unknown){
  return String(value??'Error desconocido')
    .replace(/Atz[ar]\|[A-Za-z0-9._|\-]+/g,'[redacted-token]')
    .replace(/("?(?:client_secret|refresh_token|access_token)"?\s*[:=]\s*")([^"]+)(")/gi,'$1[redacted]$3')
    .slice(0,700);
}

export function sleep(ms:number){
  return new Promise<void>(resolve=>setTimeout(resolve,ms));
}

export function retryAfterMs(headers:Headers,attempt:number){
  const raw=headers.get('retry-after');
  const seconds=raw==null?NaN:Number(raw);
  if(Number.isFinite(seconds)&&seconds>=0)return Math.min(10_000,Math.max(100,seconds*1000));
  return Math.min(8_000,500*(2**attempt));
}
