import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');const manifest=JSON.parse(fs.readFileSync(path.join(root,'workflows/MANIFEST.json')));let nodes=0;
for(const m of manifest){const raw=fs.readFileSync(m.source),original=JSON.parse(raw),copy=JSON.parse(fs.readFileSync(path.join(root,m.copy)));
 assert.equal(createHash('sha256').update(raw).digest('hex'),m.source_sha256,'Original verändert: '+m.source);
 assert.equal(copy.active,false);assert(copy.name.startsWith('CRM'));assert(!copy.id);assert.equal(copy.nodes.length,original.nodes.length);
 assert.deepEqual(copy.connections,original.connections);
 for(let i=0;i<copy.nodes.length;i++){const a=original.nodes[i],b=copy.nodes[i];assert.equal(a.name,b.name);assert.equal(a.type,b.type);assert.equal(a.typeVersion,b.typeVersion);const expected=structuredClone(a.parameters);if(a.type==='n8n-nodes-base.webhook')expected.path=expected.path.replace('trade-fair/','crm/core/');assert.deepEqual(b.parameters,expected,'Kernparameter geändert: '+a.name);if(b.type==='n8n-nodes-base.code'){new Function(b.parameters.jsCode);nodes++;}}
}
const html=fs.readFileSync(path.join(root,'CRM-Hub.html'),'utf8');new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]);
console.log(JSON.stringify({originals_unchanged:4,core_algorithms_unchanged:true,code_nodes_syntax_checked:nodes,html_script_syntax_valid:true},null,2));
