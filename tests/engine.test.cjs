const fs=require('fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=require('node:path').join(__dirname,'..');
const server=fs.readFileSync(root+'/Code.gs','utf8'),html=fs.readFileSync(root+'/Index.html','utf8');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
assert(!html.includes('answerMission'));
assert(html.includes('if(s.status==="paused")loop();else clearTimeout(timer)'),'student polling stops after lobby and after the game ends');
assert(html.includes('Коли вчитель оголосить старт, оновіть сторінку'),'lobby screen tells teams to refresh after start');
assert(html.includes('Гру запущено. Якщо команда ще бачить екран очікування'),'teacher sees a reminder to tell waiting teams to refresh');
assert(html.includes('Після цього оновіть сторінку.'),'finished teams are told to refresh for the answer key');
assert(html.includes('const baseDelay=mode==="teacher"?10000:last&&last.status==="running"&&!last.completed?20000:10000;'),'active teams poll less often than the teacher dashboard and waiting screens');
assert(html.includes('baseDelay+Math.floor(Math.random()*2501)'),'poll requests are staggered to avoid synchronized bursts');
const files=new Map(),props=new Map();let archive;
const folder={getId:()=> 'folder',getFilesByName(name){let f=files.get(name),used=false;return {hasNext:()=>!!f&&!used&&!f.trashed,next(){used=true;return f}}},createFile(name,data){const f={data,setContent(d){this.data=d},getBlob(){return {getDataAsString:()=>this.data}},setTrashed(v){this.trashed=v}};files.set(name,f);return f}};
const ctx=vm.createContext({console,Utilities:{getUuid:()=>crypto.randomUUID(),newBlob:(data,type,name)=>({data,type,name}),zip(parts){archive=Object.fromEntries(parts.map(p=>[p.name,p.data]));return {getBytes:()=>Buffer.from('test zip')}},base64Encode:b=>Buffer.from(b).toString('base64')},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},DriveApp:{createFolder:()=>folder,getFolderById:()=>folder},MimeType:{PLAIN_TEXT:'text/plain'},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}});
vm.runInContext(server,ctx);
const bank=JSON.parse(fs.readFileSync(root+'/examples/demo.json'));
assert.equal(bank.version,2);assert.deepEqual(bank.levels.map(l=>l.questions.length),[6,3,3,3,3]);
assert(bank.levels.every(l=>!Object.hasOwn(l,'points')),'point values belong to server configuration, not uploaded JSON');
assert.throws(()=>ctx.createSession(0,bank,'1234'));
assert.throws(()=>ctx.createSession(21,bank,'1234'));
assert.throws(()=>ctx.createSession(1,{...bank,version:1},'1234'));
const bad=structuredClone(bank);bad.levels[0].questions.pop();assert.throws(()=>ctx.validateBank_(bad));
const badMultiple=structuredClone(bank);badMultiple.levels[1].questions[0].correct=[0];assert.throws(()=>ctx.validateBank_(badMultiple));
const badMatching=structuredClone(bank);badMatching.levels[2].questions[0].correct=[0,0,1];assert.throws(()=>ctx.validateBank_(badMatching));
const id=ctx.createSession(2,bank,'1234').id;
assert.throws(()=>ctx.teacherState(id,'0000'));assert.throws(()=>ctx.teacherStart(id,'1234'));
assert.throws(()=>ctx.registerTeam(id,'t1','Назва',''));
const token=ctx.registerTeam(id,'t1','Дослідники','Шевченко\nКоваль\nКоваль').token;
assert.throws(()=>ctx.registerTeam(id,'t1','Зайва','Бондар'));
assert.throws(()=>ctx.registerTeam(id,'t2','Дослідники','Бондар'));
let token2=ctx.registerTeam(id,'t2','Друга команда','=HYPERLINK("test")\nІваненко').token;
assert(!JSON.stringify(ctx.publicState(id)).includes('Шевченко'));
assert(!JSON.stringify(ctx.publicState(id)).includes(token));
const state=ctx.teacherState(id,'1234');
assert.match(state.teams[1].recovery,/^\d{6}$/);
assert.notEqual(state.teams[0].recovery,state.teams[1].recovery);
assert.throws(()=>ctx.recoverTeam(id,'t2','bad'));
token2=ctx.recoverTeam(id,'t2',state.teams[1].recovery).token;
ctx.teacherStart(id,'1234');assert.throws(()=>ctx.registerTeam(id,'t2','Запізнились','Бондар'));
assert(!('role' in ctx.studentState(id,token)));
assert(!JSON.stringify(ctx.studentState(id,token)).includes('correct'));
assert.equal(ctx.studentState(id,token).question.type,'single');
assert.equal(ctx.studentState(id,token).answerKey,undefined,'answer key stays hidden until completion');
ctx.teacherControl(id,'1234','pause');assert.throws(()=>ctx.answerQuestion(id,token,0,0,0));ctx.teacherControl(id,'1234','resume');
function expectedAnswer(q){
 if(q.type==="spotError")return {errorIndex:q.correct,correctionIndex:q.correctCorrection};
 if(q.type==="shortAnswer")return "  "+q.answers[0].toLocaleUpperCase()+"  ";
 return q.correct;
}
function answer(teamToken, allowMistakes=false){
 let first=true;
 for(let levelIndex=0;levelIndex<bank.levels.length;levelIndex++){
  const level=bank.levels[levelIndex];
  for(let qi=0;qi<level.questions.length;qi++){
   const q=level.questions[qi],value=expectedAnswer(q);
   const shouldMissFirst=allowMistakes&&first;
   const shouldPartialMultiple=allowMistakes&&levelIndex===1&&qi===0;
   const shouldPartialMatching=allowMistakes&&levelIndex===2&&q.type==="matching"&&qi===0;
   const shouldPartialOrdering=allowMistakes&&levelIndex===2&&q.type==="ordering";
   const shouldPartialErrorFix=allowMistakes&&q.type==="spotError"&&qi===0;
   if(shouldMissFirst){
    const wrong=q.correct===0?1:0;
    const result=ctx.answerQuestion(id,teamToken,wrong,levelIndex,qi);assert.equal(result.correct,false);assert.equal(result.base,0);
    assert.equal(ctx.studentState(id,teamToken).questionIndex,qi+1,'a submitted wrong answer advances without retry');
    assert.throws(()=>ctx.answerQuestion(id,teamToken,value,levelIndex,qi),'the submitted question cannot be answered again');
    first=false;continue;
   }
   if(shouldPartialMultiple){
    const result=ctx.answerQuestion(id,teamToken,[...q.correct,3],levelIndex,qi);
    assert.equal(result.correct,false);assert.equal(result.base,14,'20 / 3 rounds to 7, with one wrong selection deducted');continue;
   }
   if(shouldPartialMatching){
    const partial=q.correct.slice();partial[0]=(partial[0]+1)%q.right.length;
    const result=ctx.answerQuestion(id,teamToken,partial,levelIndex,qi);
    assert.equal(result.correct,false);assert.equal(result.base,20,'two of three matches earn 20 points');continue;
   }
   if(shouldPartialOrdering){
    const partial=q.correct.slice();[partial[1],partial[2]]=[partial[2],partial[1]];
    const result=ctx.answerQuestion(id,teamToken,partial,levelIndex,qi);
    assert.equal(result.correct,false);assert.equal(result.base,16,'two correct positions earn 16 points');continue;
   }
   if(shouldPartialErrorFix){
    const partial={errorIndex:q.correct,correctionIndex:(q.correctCorrection+1)%q.corrections.length};
    const result=ctx.answerQuestion(id,teamToken,partial,levelIndex,qi);
    assert.equal(result.correct,false);assert.equal(result.base,20,'one of two parts earns 20 points');continue;
   }
   const result=ctx.answerQuestion(id,teamToken,value,levelIndex,qi);
   assert.equal(result.correct,true);assert.equal(result.base,[10,20,30,40,50][levelIndex]);assert.equal(result.correctAnswer,undefined);
  }
 }
}
answer(token,true);answer(token2,false);
assert(ctx.studentState(id,token).completed);assert(ctx.studentState(id,token2).completed);
assert.equal(ctx.studentState(id,token).answerKey,undefined,'completed teams wait until the teacher ends the whole session');
assert.equal(ctx.teacherState(id,'1234').teams[0].score,470,'partial points apply and each imperfect level loses its bonus');
assert.equal(ctx.teacherState(id,'1234').teams[1].score,630,'perfect run earns all points and bonuses');
assert.equal(ctx.gradeFromScore_(0),1);assert.equal(ctx.gradeFromScore_(480),9);assert.equal(ctx.gradeFromScore_(630),12);
assert.equal(ctx.teacherState(id,'1234').teams[0].completedQuestions,18);
assert.throws(()=>ctx.teacherExportXlsx(id,'bad'));
const xlsx=ctx.teacherExportXlsx(id,'1234');assert(xlsx.filename.endsWith('.xlsx'));assert.equal(Object.keys(archive).length,7);
assert(archive['xl/worksheets/sheet1.xml'].includes('Шевченко; Коваль; Коваль'));
assert(archive['xl/worksheets/sheet2.xml'].includes('=HYPERLINK(&quot;test&quot;)'));
assert(!archive['xl/worksheets/sheet2.xml'].includes('<f>'));
assert(archive['xl/worksheets/sheet1.xml'].includes('<v>470</v>'));
assert(archive['xl/worksheets/sheet1.xml'].includes('Оцінка'));
assert(archive['xl/worksheets/sheet1.xml'].includes('<c r="F2" s="2" t="inlineStr"><is><t xml:space="preserve">—</t></is></c>'));
assert(archive['xl/worksheets/sheet1.xml'].includes('<c r="F3" s="2" t="inlineStr"><is><t xml:space="preserve">—</t></is></c>'));
assert(archive['xl/worksheets/sheet2.xml'].includes('Оцінка'));
assert(archive['xl/worksheets/sheet2.xml'].includes('Спроб використано'));
if(process.env.QC_TEST_PARTS)fs.writeFileSync(process.env.QC_TEST_PARTS,JSON.stringify(archive));
const other=ctx.createSession(1,{...bank,title:'Інша тема'},'5678').id;
assert.equal(ctx.publicState(other).title,'Інша тема');assert.equal(ctx.publicState(id).title,bank.title);
ctx.teacherControl(id,'1234','finish');
assert.equal(ctx.studentState(id,token).answerKey.length,5,'answer key is released to all teams after session finish');
ctx.teacherExportXlsx(id,'1234');
assert(archive['xl/worksheets/sheet1.xml'].includes('<c r="F2" s="2"><v>12</v></c>'));
assert(archive['xl/worksheets/sheet1.xml'].includes('<c r="F3" s="2"><v>9</v></c>'));
assert(archive['xl/worksheets/sheet2.xml'].includes('<c r="D2" s="2"><v>9</v></c>'));
assert(archive['xl/worksheets/sheet2.xml'].includes('<c r="D5" s="2"><v>12</v></c>'));
assert.match(ctx.studentState(id,token).answerKey[0].questions[0].answer,/Знайти надійне джерело/);
ctx.teacherDelete(id,'1234');assert.throws(()=>ctx.publicState(id));assert.equal(ctx.publicState(other).status,'lobby');
console.log('PASS: v2 schema, 5 levels and 18 questions across all types, team registration, recovery, single attempts, partial scoring and bonuses, privacy, XLSX export, isolation and deletion');
