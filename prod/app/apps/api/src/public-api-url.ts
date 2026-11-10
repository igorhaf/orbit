export function publicApiUrl(){
  const configured=process.env.API_PUBLIC_URL?.trim();
  if(configured)return configured.replace(/\/+$/,'');
  return `http://localhost:${process.env.API_PORT||'4000'}`;
}
