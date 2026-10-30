import fs from 'node:fs';
const root=new URL('../',import.meta.url),file=new URL('CRM-Hub.html',root);
let html=fs.readFileSync(file,'utf8');
html=html.replace(/\n?\/\* CRM WORKSPACE V2 START \*\/[\s\S]*?\/\* CRM WORKSPACE V2 END \*\//,'');
html=html.replace(/<style id="workspace-v2">[\s\S]*?<\/style>/,'');
html=html.replace('</head>','<style id="workspace-v2">'+fs.readFileSync(new URL('workspace.css',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('projects.css',import.meta.url),'utf8')+'</style></head>');
html=html.replace('</script>','\n/* CRM WORKSPACE V2 START */\n'+fs.readFileSync(new URL('customer-language.js',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('project-summary.mjs',import.meta.url),'utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync(new URL('workspace-ui.js',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('projects-ui.js',import.meta.url),'utf8')+'\n/* CRM WORKSPACE V2 END */\n</script>');
fs.writeFileSync(file,html);new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]);console.log('Standalone CRM-Hub.html built and syntax checked.');
