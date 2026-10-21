const PREFIX="qc_v1_";
function rand_(n){return Math.floor(Math.random()*n);}
function clean_(v,max){return String(v||"").trim().replace(/[<>]/g,"").slice(0,max||80);}
function uid_(){return Utilities.getUuid().replace(/-/g,"");}
function recoveryCode_(s){let code;do{code=String(parseInt(uid_().slice(0,8),16)%1000000).padStart(6,"0");}while(s.teams.some(t=>t.recovery===code));return code;}
function totalQuestions_(bank){return bank.levels.reduce((n,l)=>n+l.questions.length,0);}
function doGet(){return HtmlService.createHtmlOutputFromFile("Index").setTitle("Quest Classroom").addMetaTag("viewport","width=device-width,initial-scale=1");}
function folder_(){const props=PropertiesService.getScriptProperties();let id=props.getProperty("QC_FOLDER");if(!id){id=DriveApp.createFolder("Quest Classroom — sessions").getId();props.setProperty("QC_FOLDER",id);}return DriveApp.getFolderById(id);}
function sessionFile_(id){if(!/^[a-f0-9]{14}$/.test(String(id)))throw Error("Некоректний код сесії");const files=folder_().getFilesByName(PREFIX+id+".json");return files.hasNext()?files.next():null;}
function store_(s){const data=JSON.stringify(s),f=sessionFile_(s.id);if(f)f.setContent(data);else folder_().createFile(PREFIX+s.id+".json",data,MimeType.PLAIN_TEXT);}
function load_(id){const f=sessionFile_(id);if(!f)throw Error("Сесію не знайдено");return JSON.parse(f.getBlob().getDataAsString());}
function guard_(f){const l=LockService.getScriptLock();l.waitLock(20000);try{return f();}finally{l.releaseLock();}}
function auth_(s,pin){if(s.pin!==String(pin))throw Error("Невірний PIN");}
function team_(i){return {id:"t"+(i+1),name:"Команда "+(i+1),members:[],access:null,score:0,level:0,question:0,completedQuestions:0,levelErrors:0};}
function createSession(count,bank,pin){return guard_(()=>{
 count=Number(count);if(!Number.isInteger(count)||count<1||count>20)throw Error("Кількість команд: 1–20");
 pin=String(pin||"");if(!/^\d{4,8}$/.test(pin))throw Error("PIN: 4–8 цифр");
 const s={id:uid_().slice(0,14),pin,bank:validateBank_(bank),status:"lobby",created:Date.now(),teams:Array.from({length:count},(_,i)=>team_(i))};
 store_(s);return {id:s.id};
});}
function publicState(id){const s=load_(id);return {status:s.status,title:s.bank.title,teams:s.teams.map(t=>({id:t.id,name:t.access?t.name:"Команда "+t.id.slice(1),registered:!!t.access}))};}
function registerTeam(id,tid,name,surnames){return guard_(()=>{
 const s=load_(id);if(s.status!=="lobby")throw Error("Реєстрацію завершено");
 const t=s.teams.find(x=>x.id===tid);if(!t||t.access)throw Error("Команда вже зареєстрована. Оновіть список.");
 name=clean_(name,40);if(name.length<2||s.teams.some(x=>x.access&&x.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error("Вкажіть унікальну назву команди (2–40 символів)");
 if(typeof surnames!=="string"||surnames.length>2000)throw Error("Введіть прізвища учасників, кожне з нового рядка");
 const members=surnames.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
 if(members.length<1||members.length>10||members.some(v=>v.length<2||v.length>80||/[<>\x00-\x1f]/.test(v)))throw Error("У команді має бути 1–10 учасників; кожне прізвище — окремим рядком, 2–80 символів");
 // Identical surnames are allowed: classmates may share a surname.
 t.name=name;t.members=members;t.access=uid_();t.recovery=recoveryCode_(s);store_(s);return {token:t.access,recovery:t.recovery};
});}
function recoverTeam(id,tid,code){return guard_(()=>{
 const s=load_(id),t=s.teams.find(x=>x.id===tid),value=String(code).trim();if(!/^\d{6}$/.test(value))throw Error("Код має містити 6 цифр");if(!t||!t.access||t.recovery!==value)throw Error("Невірний код відновлення");
 t.access=uid_();store_(s);return {token:t.access};
});}
function find_(s,token){const t=s.teams.find(t=>t.access&&t.access===token);if(!t)throw Error("Команду не знайдено");return {t};}
function teacherStart(id,pin){return guard_(()=>{
 const s=load_(id);auth_(s,pin);if(s.status!=="lobby")throw Error("Гру вже почато");
 if(s.teams.some(t=>!t.access))throw Error("Дочекайтеся реєстрації всіх команд");
 s.status="running";store_(s);return true;
});}
function question_(s,t){return s.bank.levels[t.level].questions[t.question];}
function studentState(id,token){
 const s=load_(id),{t}=find_(s,token);
 const completed=t.level>=s.bank.levels.length;
 const st={status:s.status,team:t.name,recovery:t.recovery,score:t.score,level:t.level,questionIndex:t.question,
  completedQuestions:t.completedQuestions,totalQuestions:totalQuestions_(s.bank),title:s.bank.title,completed};
 if(s.status==="finished")st.answerKey=s.bank.levels.map(l=>({title:l.title,questions:l.questions.map(q=>({prompt:q.prompt,answer:revealAnswer_(q)}))}));
 if(s.status!=="running"||completed)return st;
 const level=s.bank.levels[t.level],q=question_(s,t),question={type:q.type,prompt:q.prompt};
 if(q.options)question.options=q.options.slice();
 if(q.corrections)question.corrections=q.corrections.slice();
 if(q.left)question.left=q.left.slice();
 if(q.right)question.right=q.right.slice();
 if(q.items)question.items=q.items.slice();
 st.levelTitle=level.title;st.levelQuestion=t.question+1;st.levelTotal=level.questions.length;
 st.pointsPerQuestion=level.points;st.question=question;
 return st;
}
function sameNumbers_(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every(Number.isInteger)&&new Set(a).size===a.length&&a.slice().sort((x,y)=>x-y).every((v,i)=>v===b.slice().sort((x,y)=>x-y)[i]);}
function revealAnswer_(q){
 if(q.type==="single")return q.options[q.correct];
 if(q.type==="multiple")return q.correct.map(i=>q.options[i]).join("; ");
 if(q.type==="matching")return q.left.map((v,i)=>v+" — "+q.right[q.correct[i]]).join("\n");
 if(q.type==="ordering")return q.correct.map((i,n)=>(n+1)+". "+q.items[i]).join("\n");
 if(q.type==="spotError")return q.options[q.correct]+" → "+q.corrections[q.correctCorrection];
 if(q.type==="shortAnswer")return q.answers.join(" / ");
 return "";
}
function questionScore_(q,ans,points){
 const partial=(parts,total)=>Math.min(points,Math.max(0,Math.round(points/total)*parts));
 if(q.type==="single")return {earned:Number.isInteger(ans)&&ans===q.correct?points:0,correct:Number.isInteger(ans)&&ans===q.correct};
 if(q.type==="multiple"){
  if(!Array.isArray(ans)||ans.some(v=>!Number.isInteger(v)||v<0||v>=q.options.length)||new Set(ans).size!==ans.length)return {earned:0,correct:false};
  const expected=new Set(q.correct),hits=ans.filter(v=>expected.has(v)).length,misses=ans.filter(v=>!expected.has(v)).length;
  const correct=hits===q.correct.length&&misses===0;
  return {earned:correct?points:partial(hits-misses,q.correct.length),correct};
 }
 if(q.type==="matching"){
  if(!Array.isArray(ans)||ans.length!==q.correct.length||ans.some(v=>!Number.isInteger(v)||v<0||v>=q.right.length))return {earned:0,correct:false};
  const hits=ans.filter((v,i)=>v===q.correct[i]).length,correct=hits===q.correct.length;
  return {earned:correct?points:partial(hits,q.correct.length),correct};
 }
 if(q.type==="ordering"){
  if(!Array.isArray(ans)||ans.length!==q.correct.length||ans.some(v=>!Number.isInteger(v)||v<0||v>=q.items.length)||new Set(ans).size!==ans.length)return {earned:0,correct:false};
  const hits=ans.filter((v,i)=>v===q.correct[i]).length,correct=hits===q.correct.length;
  return {earned:correct?points:partial(hits,q.correct.length),correct};
 }
 if(q.type==="spotError"){
  const found=!!ans&&typeof ans==="object"&&ans.errorIndex===q.correct,fixed=!!ans&&typeof ans==="object"&&ans.correctionIndex===q.correctCorrection;
  const correct=found&&fixed;return {earned:correct?points:partial((found?1:0)+(fixed?1:0),2),correct};
 }
 if(q.type==="shortAnswer"){
  const correct=typeof ans==="string"&&q.answers.some(v=>normalizeAnswer_(v)===normalizeAnswer_(ans));return {earned:correct?points:0,correct};
 }
 throw Error("Невідомий тип питання");
}
function answerQuestion(id,token,ans,expectedLevel,expectedQuestion){
 return guard_(()=>{
  const s=load_(id),{t}=find_(s,token);
  if(s.status!=="running"||t.level>=s.bank.levels.length)throw Error("Зараз відповідь недоступна");
  if(expectedLevel!==t.level||expectedQuestion!==t.question)throw Error("Питання вже змінилося. Оновіть екран.");
  const level=s.bank.levels[t.level],q=question_(s,t),result=questionScore_(q,ans,level.points),earned=result.earned,correct=result.correct;
  t.score+=earned;t.completedQuestions++;t.question++;
  if(!correct)t.levelErrors++;
  let bonus=0,levelComplete=t.question>=level.questions.length;
  if(levelComplete){if(t.levelErrors===0){bonus=level.bonus;t.score+=bonus;}t.level++;t.question=0;t.levelErrors=0;}
  store_(s);
  if(!correct){
   return {correct:false,base:earned,bonus,levelComplete,completed:t.level>=s.bank.levels.length,
    message:(earned?"Частково правильно: +"+earned+" балів. ":"Неправильно: 0 балів. ")+"Спробу зараховано, виправити відповідь уже не можна. Бонус за рівень втрачено."};
  }
  return {correct:true,base:earned,bonus,levelComplete,completed:t.level>=s.bank.levels.length,
   message:"Правильно! +"+earned+(bonus?" і бонус рівня +"+bonus:"")+" балів."};
 });
}
function teacherState(id,pin){
 const s=load_(id);auth_(s,pin);
 return {status:s.status,id:s.id,title:s.bank.title,total:totalQuestions_(s.bank),levels:s.bank.levels.length,teams:s.teams.map(t=>({
  id:t.id,name:t.name,registered:!!t.access,recovery:t.recovery||"",level:t.level,question:t.question,completedQuestions:t.completedQuestions,score:t.score,
  members:t.members.slice(),
  lockSeconds:0
 }))};
}
function normalizeAnswer_(v){return String(v||"").trim().toLocaleLowerCase().replace(/\s+/g," ");}
function teacherAdjust(id,pin,tid,delta){return guard_(()=>{const s=load_(id);auth_(s,pin);const t=s.teams.find(x=>x.id===tid);delta=Number(delta);if(!t||!Number.isFinite(delta)||Math.abs(delta)>1000)throw Error("Невірні дані");t.score=Math.max(0,t.score+Math.round(delta));store_(s);return true;});}
function teacherUnlock(id,pin,tid){return guard_(()=>{const s=load_(id);auth_(s,pin);const t=s.teams.find(x=>x.id===tid);if(!t)throw Error("Команду не знайдено");t.lockUntil=0;store_(s);return true;});}
function teacherControl(id,pin,action){return guard_(()=>{const s=load_(id);auth_(s,pin);if(action==="pause"&&s.status==="running")s.status="paused";else if(action==="resume"&&s.status==="paused")s.status="running";else if(action==="finish"&&["running","paused"].includes(s.status))s.status="finished";else throw Error("Дія недоступна");store_(s);return true;});}
/** Адреса опублікованого вебзастосунку для QR та запрошень. */
function appUrl(){return ScriptApp.getService().getUrl();}


function validateBank_(input){
 const fail=m=>{throw Error("Файл завдань: "+m);};
 if(!input||typeof input!=="object"||input.version!==2)fail("потрібен формат version: 2");
 const text=(v,max,label)=>{if(typeof v!=="string"||!v.trim()||v.length>max)fail(label);return v.trim();};
 const indexes=(a,min,max,size,label)=>{if(!Array.isArray(a)||a.length<min||a.length>max||a.some(x=>!Number.isInteger(x)||x<0||x>=size)||new Set(a).size!==a.length)fail(label);return a.slice();};
 const title=text(input.title,120,"вкажіть назву до 120 символів");
 if(!Array.isArray(input.levels)||input.levels.length!==5)fail("потрібно рівно 5 рівнів");
 const rules=[{count:6,type:"single",points:10,bonus:10},{count:3,type:"multiple",points:20,bonus:20},{count:3,type:null,points:30,bonus:30},{count:3,type:"spotError",points:40,bonus:40},{count:3,type:"shortAnswer",points:50,bonus:50}];
 const levels=input.levels.map((l,li)=>{
  const rule=rules[li],label="рівень "+(li+1)+": ";
  if(!l||typeof l!=="object"||!Array.isArray(l.questions)||l.questions.length!==rule.count)fail(label+"має бути рівно "+rule.count+" питань");
  const questions=l.questions.map((q,qi)=>{
   const where=label+"питання "+(qi+1)+": ";
   if(!q||typeof q!=="object")fail(where+"невірний формат");
   const type=li<2?rule.type:q.type,prompt=text(q.prompt,2000,where+"додайте текст питання");
   if(li===0||li===1){
    if(q.type!==type)fail(where+"тип має бути "+type);
    if(!Array.isArray(q.options)||q.options.length<(li===0?2:3)||q.options.length>8)fail(where+"додайте від "+(li===0?2:3)+" до 8 варіантів");
    const options=q.options.map(v=>text(v,1000,where+"порожній варіант"));
    if(type==="single"){
     if(!Number.isInteger(q.correct)||q.correct<0||q.correct>=options.length)fail(where+"correct — індекс правильної відповіді від 0");
     return {type,prompt,options,correct:q.correct};
    }
    return {type,prompt,options,correct:indexes(q.correct,2,options.length,options.length,where+"correct має містити індекси щонайменше двох правильних варіантів")};
   }
   if(type==="matching"){
    if(!Array.isArray(q.left)||q.left.length<2||q.left.length>8||!Array.isArray(q.right)||q.right.length!==q.left.length)fail(where+"matching потребує однакову кількість 2–8 елементів зліва і справа");
    const left=q.left.map(v=>text(v,300,where+"порожній елемент зліва")),right=q.right.map(v=>text(v,300,where+"порожній елемент справа"));
    return {type,prompt,left,right,correct:indexes(q.correct,left.length,left.length,right.length,where+"correct має бути відповідністю індексів правого списку")};
   }
   if(type==="ordering"){
    if(!Array.isArray(q.items)||q.items.length<3||q.items.length>8)fail(where+"ordering потребує 3–8 елементів");
    const items=q.items.map(v=>text(v,300,where+"порожній елемент"));
    return {type,prompt,items,correct:indexes(q.correct,items.length,items.length,items.length,where+"correct має бути повною послідовністю індексів")};
   }
   if(li===3){
    if(type!=="spotError")fail(where+"тип четвертого рівня має бути spotError");
    if(!Array.isArray(q.options)||q.options.length<3||q.options.length>8)fail(where+"spotError потребує 3–8 тверджень");
    const options=q.options.map(v=>text(v,1000,where+"порожнє твердження"));
    if(!Number.isInteger(q.correct)||q.correct<0||q.correct>=options.length)fail(where+"correct — індекс помилкового твердження від 0");
    if(!Array.isArray(q.corrections)||q.corrections.length<2||q.corrections.length>8)fail(where+"додайте 2–8 варіантів виправлення");
    const corrections=q.corrections.map(v=>text(v,1000,where+"порожній варіант виправлення"));
    if(!Number.isInteger(q.correctCorrection)||q.correctCorrection<0||q.correctCorrection>=corrections.length)fail(where+"correctCorrection — індекс правильного виправлення від 0");
    return {type,prompt,options,correct:q.correct,corrections,correctCorrection:q.correctCorrection};
   }
   if(li===4){
    if(type!=="shortAnswer")fail(where+"тип п’ятого рівня має бути shortAnswer");
    if(!Array.isArray(q.answers)||q.answers.length<1||q.answers.length>10)fail(where+"shortAnswer потребує 1–10 прийнятних відповідей");
    return {type,prompt,answers:q.answers.map(v=>text(v,300,where+"порожній варіант відповіді"))};
   }
   fail(where+"невідомий тип питання");
  });
  return {title:text(l.title||("Рівень "+(li+1)),80,label+"назва"),points:rule.points,bonus:rule.bonus,questions};
 });
 const bank={version:2,title,levels};if(JSON.stringify(bank).length>150000)fail("завеликий файл");return bank;
}
function teacherDelete(id,pin){return guard_(()=>{const s=load_(id);auth_(s,pin);sessionFile_(id).setTrashed(true);return true;});}

/** Minimal OOXML exporter: text cells are inline strings, never formulas. No external service. */
function reportRows_(s){
 const ranked=s.teams.filter(t=>t.access).slice().sort((a,b)=>b.score-a.score);
 let previous=null,place=0;
 const total=totalQuestions_(s.bank);
 const rows=[["Місце","Команда","Склад команди","Учасників","Бали команди","Спроб використано","Усього питань","Стан"]];
 ranked.forEach((t,i)=>{if(t.score!==previous)place=i+1;previous=t.score;rows.push([place,t.name,t.members.join("; "),t.members.length,t.score,t.completedQuestions,total,t.completedQuestions>=total?"Усі питання завершено":s.status==="finished"?"Гру завершено":"У процесі"]);});
 return rows;
}
function xml_(v){return String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));}
function sheetXml_(rows,widths){
 const letters=i=>{let s="";for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join("")+'</cols><sheetData>'+rows.map((r,i)=>'<row r="'+(i+1)+'">'+r.map((v,j)=>{const ref=letters(j)+(i+1),style=i===0?1:2;return typeof v==="number"?'<c r="'+ref+'" s="'+style+'"><v>'+v+'</v></c>':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml_(v)+'</t></is></c>';}).join("")+'</row>').join("")+'</sheetData><autoFilter ref="A1:'+letters(rows[0].length-1)+rows.length+'"/></worksheet>';
}
function teacherExportXlsx(id,pin){
 const s=load_(id);auth_(s,pin);
 const detail=[["Команда","Прізвище учасника","Бали команди","Спроб використано"]];
 s.teams.filter(t=>t.access).forEach(t=>t.members.forEach(m=>detail.push([t.name,m,t.score,t.completedQuestions])));
 const parts={
 '[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
 '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Результати команд" sheetId="1" r:id="rId1"/><sheet name="Учасники" sheetId="2" r:id="rId2"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
 'xl/styles.xml':'<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174A61"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
 'xl/worksheets/sheet1.xml':sheetXml_(reportRows_(s),[10,25,65,12,16,20,18,28]),
 'xl/worksheets/sheet2.xml':sheetXml_(detail,[25,35,18,20])
 };
 const blob=Utilities.zip(Object.keys(parts).map(name=>Utilities.newBlob(parts[name],"application/xml",name)),"results.xlsx");
 return {filename:"Quest_Classroom_"+id+".xlsx",base64:Utilities.base64Encode(blob.getBytes())};
}
