import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {catalog} from '../catalog.mjs';
import {validateTaskChange,publicCase} from '../domain.mjs';
const employee={fullName:'Test Person',personalEmail:'test@example.invalid',companyEmail:'',department:'Marketing',role:'Specialist',manager:'Mara Winter',startDate:'2026-11-02'};
function code(name,input){return new vm.Script('(function(){'+fs.readFileSync(new URL('../nodes/'+name+'.js',import.meta.url),'utf8')+'})()').runInNewContext({$input:{first:()=>({json:input})}})[0].json;}
test('Portal replaces all Slack and Notion tasks, without dropping checklist requirements',()=>{assert.equal(catalog.length,33);assert.equal(catalog.filter(t=>!t.marketing).length,20);assert.ok(!/slack|notion/i.test(JSON.stringify(catalog)));assert.match(catalog.find(t=>t.id==='G06').title,/Mitarbeiterportal/);});
test('missing company address remains an explicit warning, invalid address is rejected',()=>{const r=code('validate',{employee});assert.equal(r.valid,true);assert.ok(r.warnings.some(s=>s.includes('Firmen-E-Mail')));assert.equal(code('validate',{employee:{...employee,companyEmail:'invalid'}}).valid,false);});
test('invalid date and missing manager rejected',()=>{assert.equal(code('validate',{employee:{...employee,startDate:'2026-02-30',manager:''}}).valid,false);});
test('one and two week check-ins use calendar weeks',()=>{const r=code('plan',{employee,catalog,checklist:catalog});assert.equal(r.tasks.find(t=>t.id==='G20').due,'2026-11-09');assert.equal(r.tasks.find(t=>t.id==='M13').due,'2026-11-16');});
test('completion requires evidence, blocked requires explanation',()=>{assert.throws(()=>validateTaskChange({}, {state:'done'}));assert.throws(()=>validateTaskChange({}, {state:'blocked'}));assert.throws(()=>validateTaskChange({}, {state:'invented'}));assert.equal(validateTaskChange({owner:'IT'},{state:'done',evidence:'Confirmed by IT'}).state,'done');});
test('employee projection excludes HR comments, contracts, emails and workflow payloads',()=>{const r=publicCase({id:'x',employee,result:{tasks:[{id:'G03',title:'contract',comments:['private']},{id:'G17',title:'training',comments:['private'],evidence:'private'}]},runs:[{capability:'secret'}]});assert.equal(r.tasks.length,1);assert.ok(!/secret|private|personalEmail|contract/.test(JSON.stringify(r)));});
