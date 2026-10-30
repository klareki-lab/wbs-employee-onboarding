import test from 'node:test';
import assert from 'node:assert/strict';
import {crmReport,taskMetrics} from '../src/leadership-report.mjs';
const task=(id,status,due)=>({id,kind:'task',project_id:'p',owner_id:'u',version:1,data:{title:id,status,due_at:due,assignee_id:'u'}});
test('CRM statistics distinguish known completion, missing evidence, overdue and cancelled',()=>{
 const records=[{id:'p',kind:'project',data:{title:'Projekt',stage:'won',delivery_status:'active'},owner_id:'u'},task('a','done','2026-10-29'),task('b','done','2026-10-27'),task('c','done','2026-10-27'),task('d','open','2026-10-27'),task('e','cancelled','2026-10-27')];
 const history=['a','b'].map(record_id=>({record_id,after_data:{data:{status:'done'}},created_at:'2026-10-29T12:00:00Z'}));
 const report=crmReport(records,[{id:'u',name:'Berater',active:true}],history,new Date('2026-10-30T08:00:00Z'));
 assert.equal(report.metrics.onTimePercent,50);assert.equal(report.metrics.unknown,1);assert.equal(report.metrics.overdue,1);assert.equal(report.metrics.total,4);assert.equal(report.projects[0].status,'active');assert.equal(report.projects[0].sales_stage,'won');
});
test('Berlin midnight determines deadlines; edits after completion do not change it',()=>{const records=[{id:'p',kind:'project',data:{title:'P'},owner_id:'u'},task('a','done','2026-10-29')];const history=[{record_id:'a',after_data:{data:{status:'done'}},created_at:'2026-10-29T23:30:00Z'},{record_id:'a',before_data:{data:{status:'done'}},after_data:{data:{status:'done'}},created_at:'2026-11-15T10:00:00Z'}];const r=crmReport(records,[],history);assert.equal(r.metrics.late,1);assert.equal(r.projects[0].tasks[0].completed_at,'2026-10-29T23:30:00Z');});
test('No invented rates when no dated completions exist',()=>{assert.equal(taskMetrics([]).onTimePercent,null);assert.equal(taskMetrics([]).completionPercent,null);});
