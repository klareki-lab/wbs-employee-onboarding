export async function coordinator(path:string,method='GET',body?:unknown){
 let csrf='';
 if(method!=='GET'){const r=await fetch('/api/workspace/profile');if(!r.ok)throw new Error('Bitte erneut anmelden.');csrf=(await r.json()).data.csrf;}
 const r=await fetch('/coordinator'+path,{method,headers:{'Content-Type':'application/json','X-Onboarding-CSRF':csrf},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(typeof data.error==='string'?data.error:r.status===403?'Keine Berechtigung für diesen Bereich.':'Der Onboarding-Dienst ist momentan nicht erreichbar.');return data;
}
