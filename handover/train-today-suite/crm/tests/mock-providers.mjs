// LOCAL TEST DOUBLES ONLY. This service never makes outbound requests or sends email.
import http from 'node:http';
const counts={research:0,extraction:0,email:0},accepted=new Map();
http.createServer(async(req,res)=>{
 let raw='';for await(const c of req){raw+=c;if(raw.length>400000){res.writeHead(413);res.end();return;}}
 let input;try{input=JSON.parse(raw||'{}');}catch{res.writeHead(400);res.end();return;}
 let result;
 if(req.url==='/tavily'){counts.research++;result={results:[{title:'Lokale Testquelle – keine echte Recherche',url:'https://example.com/about',content:'Synthetic local integration fixture. No verified information about the company.'}]};}
 else if(req.url==='/openai'){counts.extraction++;const value=Object.fromEntries(['summary','participant_count','timeframe','language','training_interest','budget_status','follow_up'].map(k=>[k,{value:null,evidence:null}]));result={choices:[{finish_reason:'stop',message:{content:JSON.stringify({...value,training_topics:[],needs_human_review:true})}}]};}
 else if(req.url==='/resend'){counts.email++;const key=req.headers['idempotency-key'];if(!accepted.has(key))accepted.set(key,'local-mock-email-'+accepted.size);result={id:accepted.get(key)};}
 else if(req.url==='/stats')result={...counts,unique_email_acceptances:accepted.size,external_requests:0};
 else{res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
}).listen(3090,'0.0.0.0',()=>console.log('Lokale Testdienste auf Port 3090. Kein externer Versand.'));
