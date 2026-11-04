import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export function parseRpcResponse(raw) {
 const text=raw.replace(/^\uFEFF/,'').trim();
 if(text.startsWith('{'))return JSON.parse(text);
 for(const event of text.replace(/\r\n?/g,'\n').split(/\n\n+/)){
  const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
  if(!data)continue;
  const message=JSON.parse(data);
  if(message.id===1&&('result' in message||'error' in message))return message;
 }
 throw new Error('n8n MCP: Keine passende JSON-RPC-Antwort empfangen.');
}
export async function rpc(method,params={}) {
 const config=JSON.parse(await fs.readFile(process.env.N8N_MCP_CONFIG||new URL('../.mcp.json',import.meta.url),'utf8')).mcpServers['n8n-mcp'];
 const res=await fetch(process.env.N8N_MCP_URL||config.url,{method:'POST',headers:{...config.headers,Accept:'application/json, text/event-stream','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(120000)});
 if(!res.ok)throw new Error(`n8n MCP: ${res.status}`);
 const msg=parseRpcResponse(await res.text());
 if(msg.error)throw new Error(JSON.stringify(msg.error));return msg.result;
}
export async function call(name,args={}) {return rpc('tools/call',{name,arguments:args});}
export function unwrap(r) {const v=r.structuredContent??JSON.parse(r.content.find(x=>x.type==='text').text);if(r.isError||v.error)throw new Error(typeof v.error==='string'?v.error:JSON.stringify(v));return v;}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const arg=process.argv[3]?JSON.parse(await fs.readFile(process.argv[3],'utf8')):{};
 console.log(JSON.stringify(process.argv[2]==='list'?await rpc('tools/list'):await call(process.argv[2],arg),null,2));
}
