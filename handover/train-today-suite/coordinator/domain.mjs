import {visiblePersonal} from './task-actions.mjs';
export const taskStates=['open','in_progress','blocked','done'];
export const employeeTasks=new Set(['G06','G07','G17','G18','M09','M10']);
export function validateTaskChange(task,input){
 if(!taskStates.includes(input.state))throw Object.assign(new Error('Ungültiger Aufgabenstatus.'),{status:400});
 if(input.state==='done'&&!String(input.evidence||'').trim())throw Object.assign(new Error('Bitte einen Abschlussnachweis oder eine Bestätigung angeben.'),{status:400});
 if(input.state==='blocked'&&!String(input.comment||'').trim())throw Object.assign(new Error('Bitte den Grund der Blockierung angeben.'),{status:400});
 return {...task,completedAt:input.state==='done'?(task.state==='done'?task.completedAt||null:new Date().toISOString()):null,state:input.state,assignee:String(input.assignee||task.assignee||task.owner).trim().slice(0,160),evidence:String(input.evidence||'').trim().slice(0,2000)};
}
export function publicCase(c){return {id:c.id,employeeName:c.employee.fullName,startDate:c.employee.startDate,manager:c.employee.manager,department:c.employee.department,tasks:(c.result?.tasks||[]).filter(t=>employeeTasks.has(t.id)||(t.actionPublished&&visiblePersonal(t))).map(t=>({id:t.id,title:t.title,due:t.due,state:t.state||'open',owner:t.owner,confirmationRequested:!!t.employeeConfirmation,resourceUrl:t.resourceUrl||null}))};}
