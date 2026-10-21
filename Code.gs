function caseTask_(s,t){return question_(s,t).research[t.variants[t.stage]];}
const PREFIX="qc_v1_";
function rand_(n){return Math.floor(Math.random()*n);}
function shuffle_(a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=rand_(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function clean_(v,max){return String(v||"").trim().replace(/[<>]/g,"").slice(0,max||80);}
function uid_(){return Utilities.getUuid().replace(/-/g,"");}
function recoveryCode_(s){let code;do{code=String(parseInt(uid_().slice(0,8),16)%1000000).padStart(6,"0");}while(s.teams.some(t=>t.recovery===code));return code;}
function doGet(){return HtmlService.createHtmlOutputFromFile("Index").setTitle("Quest Classroom").addMetaTag("viewport","width=device-width,initial-scale=1");}
function folder_(){const props=PropertiesService.getScriptProperties();let id=props.getProperty("QC_FOLDER");if(!id){id=DriveApp.createFolder("Quest Classroom — sessions").getId();props.setProperty("QC_FOLDER",id);}return DriveApp.getFolderById(id);}
function sessionFile_(id){if(!/^[a-f0-9]{14}$/.test(String(id)))throw Error("Некоректний код сесії");const files=folder_().getFilesByName(PREFIX+id+".json");return files.hasNext()?files.next():null;}
function store_(s){const data=JSON.stringify(s),f=sessionFile_(s.id);if(f)f.setContent(data);else folder_().createFile(PREFIX+s.id+".json",data,MimeType.PLAIN_TEXT);}
function load_(id){const f=sessionFile_(id);if(!f)throw Error("Сесію не знайдено");return JSON.parse(f.getBlob().getDataAsString());}
function guard_(f){const l=LockService.getScriptLock();l.waitLock(20000);try{return f();}finally{l.releaseLock();}}
function auth_(s,pin){if(s.pin!==String(pin))throw Error("Невірний PIN");}
function team_(i){return {id:"t"+(i+1),name:"Команда "+(i+1),members:[],access:null,score:0,stage:0,step:0,tries:0,variants:[],pending:null,lockUntil:0};}
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
 s.teams.forEach(t=>{t.variants=s.bank.rounds.map(r=>rand_(r.cases.length));});s.status="running";store_(s);return true;
});}
function question_(s,t){return s.bank.rounds[t.stage];}
function studentState(id,token){
 const s=load_(id),{t}=find_(s,token);
 const step=t.step||0;
 const st={status:s.status,team:t.name,recovery:t.recovery,score:t.score,stage:t.stage,step,total:s.bank.rounds.length,
  lockSeconds:Math.max(0,Math.ceil((t.lockUntil-Date.now())/1000)),pending:!!t.pending,episode:s.episode,title:s.bank.title,nameChanged:true};
 if(s.status!=="running"||t.stage>=s.bank.rounds.length){st.completed=t.stage>=s.bank.rounds.length;return st;}
 const q=question_(s,t),c=q.cases[t.variants[t.stage]],tasks=["",q.justify];
 st.info=q.info;
 st.mission={title:q.title||"Місія "+(t.stage+1),step,prompt:c[0],options:step===1?c[1]:[],research:caseTask_(s,t),justify:tasks[1],review:!!q.review};
 return st;
}
function nextStage_(s,t){
 t.stage++;t.step=0;t.tries=0;t.evidence="";
 
}
function answerMission(id,token,ans,expectedStage,expectedStep){
 return guard_(()=>{
  const s=load_(id),{t}=find_(s,token);
  if(s.status!=="running"||t.pending||t.stage>=s.bank.rounds.length||t.lockUntil>Date.now())throw Error("Зараз відповідь недоступна");
  const q=question_(s,t),c=q.cases[t.variants[t.stage]],step=t.step||0;
  if(expectedStage!==t.stage||expectedStep!==step)throw Error("Етап уже змінився. Оновіть екран.");
  if(step===0){
   const fields=ans&&typeof ans==="object"&&!Array.isArray(ans)?ans:null;
   if(!fields)throw Error("Заповніть чотири поля дослідження.");
   const device=clean_(fields.device,120),purpose=clean_(fields.purpose,240),
    specs=clean_(fields.specs,350),source=clean_(fields.source,300);
   if(device.length<3)throw Error("Поле 1: назвіть об’єкт дослідження.");
   if(purpose.length<15)throw Error("Поле 2: поясніть призначення (від 15 символів).");
   if(specs.length<20)throw Error("Поле 3: наведіть два факти або характеристики (від 20 символів).");
   if(source.length<6)throw Error("Поле 4: зазначте джерело (сайт, виробника або підручник).");
   const evidence="Об’єкт дослідження: "+device+"\nПризначення: "+purpose+"\nДокази: "+specs+"\nДжерело: "+source;
   t.evidence=evidence;t.step=1;store_(s);
   return {message:"Дослідження збережено. Далі — діагностика.",correct:true};
  }
  if(step===1){
   const a=Number(ans);
   if(!Number.isInteger(a)||a<0||a>=c[1].length)throw Error("Оберіть відповідь");
   if(a!==c[2]){t.tries++;store_(s);return {message:"Рішення не підходить. Зіставте досьє та дослідження; спробуйте ще.",correct:false};}
   const points=Math.max(30,100-t.tries*30);
   t.score+=points;t.tries=0;t.step=2;store_(s);
   return {message:"Діагностику пройдено! +"+points+" балів. Тепер захистіть рішення.",correct:true};
  }
  if(step===2){
   const explanation=clean_(ans,1200);
   if(explanation.length<95)throw Error("Аргументація має містити щонайменше 95 символів.");
   if(q.review){
    t.pending={stage:t.stage,answerText:explanation,evidence:t.evidence};
    store_(s);return {message:"Рішення передано вчителю на перевірку.",correct:null};
   }
   // Text is recorded as work evidence; it is NOT automatically considered correct or awarded points.
   if(!t.reflections)t.reflections=[];
   t.reflections.push({stage:t.stage,evidence:t.evidence,explanation});
   nextStage_(s,t);store_(s);return {message:"Аргументацію збережено. Перехід до нової місії (без автоматичної оцінки тексту).",correct:true};
  }
  throw Error("Невідомий етап");
 });
}
function teacherState(id,pin){
 const s=load_(id);auth_(s,pin);
 return {status:s.status,id:s.id,episode:s.episode,title:s.bank.title,total:s.bank.rounds.length,teams:s.teams.map(t=>({
  id:t.id,name:t.name,registered:!!t.access,recovery:t.recovery||"",stage:t.stage,step:t.step||0,score:t.score,
  members:t.members.slice(),
  pending:t.pending?{title:question_(s,t).cases[t.variants[t.stage]][0],
    answer:t.pending.answerText,expected:"Перевірте докази, логіку рішення й відповідність умовам.",
    evidence:t.pending.evidence}:null,
  lockSeconds:Math.max(0,Math.ceil((t.lockUntil-Date.now())/1000)),emergency:!!t.emergency
 }))};
}
function teacherReview(id,pin,tid,points,accept){return guard_(()=>{const s=load_(id);auth_(s,pin);const t=s.teams.find(x=>x.id===tid);if(!t||!t.pending)throw Error("Немає відповіді");if(s.status!=="running")throw Error("Перевірка доступна під час гри");if(accept){points=Number(points);if(!Number.isFinite(points)||points<0||points>100)throw Error("Бали 0–100");t.score+=Math.round(points);if(!t.reflections)t.reflections=[];t.reflections.push({...t.pending,points:Math.round(points)});nextStage_(s,t);}t.pending=null;store_(s);return true;});}
function teacherAdjust(id,pin,tid,delta){return guard_(()=>{const s=load_(id);auth_(s,pin);const t=s.teams.find(x=>x.id===tid);delta=Number(delta);if(!t||!Number.isFinite(delta)||Math.abs(delta)>1000)throw Error("Невірні дані");t.score=Math.max(0,t.score+Math.round(delta));store_(s);return true;});}
function teacherUnlock(id,pin,tid){return guard_(()=>{const s=load_(id);auth_(s,pin);const t=s.teams.find(x=>x.id===tid);if(!t)throw Error("Команду не знайдено");t.lockUntil=0;store_(s);return true;});}
function teacherControl(id,pin,action){return guard_(()=>{const s=load_(id);auth_(s,pin);if(action==="pause"&&s.status==="running")s.status="paused";else if(action==="resume"&&s.status==="paused")s.status="running";else if(action==="finish"&&["running","paused"].includes(s.status))s.status="finished";else throw Error("Дія недоступна");store_(s);return true;});}
/** Адреса опублікованого вебзастосунку для QR та запрошень. */
function appUrl(){return ScriptApp.getService().getUrl();}


function validateBank_(input){
 const fail=m=>{throw Error("Файл завдань: "+m);};
 if(!input||typeof input!=="object"||input.version!==1)fail("потрібен формат version: 1");
 const text=(v,max,label)=>{if(typeof v!=="string"||!v.trim()||v.length>max)fail(label);return v.trim();};
 const title=text(input.title,120,"вкажіть назву до 120 символів");
 if(!Array.isArray(input.rounds)||input.rounds.length<1||input.rounds.length>30)fail("потрібно 1–30 місій");
 const rounds=input.rounds.map((r,i)=>{
  if(!r||typeof r!=="object")fail("місія "+(i+1));
  const label="місія "+(i+1)+": ";
  const info=text(r.info,5000,label+"немає досьє"),justify=text(r.justify,2000,label+"немає завдання захисту");
  if(typeof r.review!=="boolean")fail(label+"review має бути true або false");
  if(!Array.isArray(r.cases)||!r.cases.length||r.cases.length>10)fail(label+"потрібно 1–10 кейсів");
  if(!Array.isArray(r.research)||r.research.length!==r.cases.length)fail(label+"кожному кейсу потрібне пошукове завдання research");
  const cases=r.cases.map(c=>{
   if(!Array.isArray(c)||c.length!==3||!Array.isArray(c[1])||c[1].length<2||c[1].length>6)fail(label+"кейс: [питання, варіанти, індекс відповіді]");
   if(!Number.isInteger(c[2])||c[2]<0||c[2]>=c[1].length)fail(label+"індекс правильної відповіді починається з 0");
   return [text(c[0],2000,label+"питання"),c[1].map(v=>text(v,1000,label+"варіант відповіді")),c[2]];
  });
  return {title:text(r.title,120,label+"назва місії"),info,justify,review:r.review,cases,research:r.research.map(v=>text(v,2000,label+"пошукове завдання"))};
 });
 const bank={version:1,title,rounds};if(JSON.stringify(bank).length>150000)fail("завеликий файл");return bank;
}
function teacherDelete(id,pin){return guard_(()=>{const s=load_(id);auth_(s,pin);sessionFile_(id).setTrashed(true);return true;});}

/** Minimal OOXML exporter: text cells are inline strings, never formulas. No external service. */
function reportRows_(s){
 const ranked=s.teams.filter(t=>t.access).slice().sort((a,b)=>b.score-a.score);
 let previous=null,place=0;
 const rows=[["Місце","Команда","Склад команди","Учасників","Бали команди","Місій завершено","Усього місій","Стан"]];
 ranked.forEach((t,i)=>{if(t.score!==previous)place=i+1;previous=t.score;rows.push([place,t.name,t.members.join("; "),t.members.length,t.score,t.stage,s.bank.rounds.length,t.stage>=s.bank.rounds.length?"Усі місії завершено":t.pending?"Очікує перевірки":s.status==="finished"?"Гру завершено":"У процесі"]);});
 return rows;
}
function xml_(v){return String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));}
function sheetXml_(rows,widths){
 const letters=i=>{let s="";for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join("")+'</cols><sheetData>'+rows.map((r,i)=>'<row r="'+(i+1)+'">'+r.map((v,j)=>{const ref=letters(j)+(i+1),style=i===0?1:2;return typeof v==="number"?'<c r="'+ref+'" s="'+style+'"><v>'+v+'</v></c>':'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml_(v)+'</t></is></c>';}).join("")+'</row>').join("")+'</sheetData><autoFilter ref="A1:'+letters(rows[0].length-1)+rows.length+'"/></worksheet>';
}
function teacherExportXlsx(id,pin){
 const s=load_(id);auth_(s,pin);
 const detail=[["Команда","Прізвище учасника","Бали команди","Місій завершено"]];
 s.teams.filter(t=>t.access).forEach(t=>t.members.forEach(m=>detail.push([t.name,m,t.score,t.stage])));
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
