/* 수업 활동 모듈 — 교사 쪽.
   classroom/teacher.html 의 '수업 활동' 칸에 붙어서 다음을 한다.
   - 수업 흐름 짜기: 단계(주관식·객관식·영상 보기·페이지 열기)를 모아 이름을 붙여 저장하고, 다음 수업에 불러온다.
   - 단계 실행: 한 단계씩 학생 화면에 띄운다(▶ 시작 / 다음 단계). 한 번에 하나만 열려 있다.
   - 진행 현황: 몇 명이 냈는지, 객관식은 보기별 인원.
   - 큰 화면: 모두의 답을 카드·막대로 크게 보여 준다(이름 가리기, 누르면 확대, 정답·결과 공개, 마감).
   - 저장: 이번 활동 또는 오늘 수업 전체를 CSV(엑셀)로 내려받는다.
   서버 함수는 classroom/activity/schema.sql 의 cra_admin_* 이다. 학생 글은 모두 textContent 로만 넣는다.
   사용: ClassroomActivity.mount({root, rpc, getRoom, isMock, command}) / ClassroomActivity.stop() */
(()=>{
  'use strict';
  if(window.ClassroomActivity)return;

  const KINDS={text:'✍️ 주관식',choice:'✅ 객관식',draw:'🎨 그림',photo:'📷 사진',video:'▶️ 영상 보기',page:'🌐 페이지 열기'};
  const isImg=k=>k==='draw'||k==='photo';
  const MARK=['①','②','③','④','⑤','⑥'];
  const POLL_MS=3000;

  const CSS=`
  .cra{--cb:#1c1c22}
  .cra h4{margin:0 0 6px;font-size:16px}
  .cra .cra-flowbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
  .cra .cra-flowbar input{min-width:200px;flex:1}
  .cra-step{border:1px solid var(--line);border-radius:12px;padding:10px;margin:8px 0;background:#15151b}
  .cra-step.run{border-color:var(--green);box-shadow:0 0 0 1px var(--green) inset}
  .cra-step .top{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .cra-step .no{font-weight:800;color:var(--blue);min-width:26px}
  .cra-step input[type=text],.cra-step textarea,.cra-step select{background:#0f0f14}
  .cra-step input.t{flex:1;min-width:220px}
  .cra-step textarea{width:100%;min-height:84px;font:inherit;color:inherit;border:1px solid var(--line);border-radius:10px;padding:8px;margin-top:8px}
  .cra-step .mini{padding:6px 10px;font-size:13px}
  .cra-timer{margin-top:6px;font:800 20px system-ui;color:#f59e0b}
  .cra-choices{margin-top:8px;display:grid;gap:6px}
  .cra-crow{display:flex;gap:8px;align-items:center}
  .cra-crow .no{font-weight:800;min-width:1.6em;text-align:center}
  .cra-crow input[type=text]{flex:1;min-width:0}
  .cra-crow.ans input[type=text]{border-color:#16a34a}
  .cra-crow label{white-space:nowrap;cursor:pointer}
  .cra-step .sub{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .cra-live{border:1px solid var(--line);border-radius:14px;padding:12px;margin:12px 0;background:#15151b}
  .cra-chip{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;background:#16351f;color:#75e38c}
  .cra-chip.closed{background:#2a2a31;color:#d0d0d8}
  .cra-bars{margin-top:8px}
  .cra-bar{position:relative;margin:5px 0;border:1px solid var(--line);border-radius:10px;overflow:hidden;padding:6px 10px;font-size:14px;background:#0f0f14}
  .cra-bar i{position:absolute;left:0;top:0;bottom:0;background:#26435a;opacity:.7}
  .cra-bar.ans i{background:#1f6b36}
  .cra-bar span{position:relative}
  /* 큰 화면 */
  #craBig{position:fixed;inset:0;z-index:10000;background:#0b0b10;color:#fff;display:flex;flex-direction:column}
  #craBig .hd{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:14px 18px;border-bottom:1px solid #2b2b34;background:#14141a}
  #craBig .hd .q{flex:1;min-width:260px;font-size:clamp(20px,3.2vw,36px);font-weight:800;line-height:1.35;word-break:keep-all;overflow-wrap:anywhere;white-space:pre-wrap}
  #craBig .hd .st{color:#a1a1aa;font-size:18px;white-space:nowrap}
  #craBig .bd{flex:1;overflow:auto;padding:18px}
  #craBig .cards{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(var(--cw,280px),1fr))}
  #craBig .card{background:#1c1c22;border:1px solid #34343d;border-radius:16px;padding:14px 16px;cursor:zoom-in;word-break:break-word;overflow-wrap:anywhere;white-space:pre-wrap;line-height:1.55;font-size:var(--fs,22px)}
  #craBig .card small{display:block;color:#64d2ff;font-weight:800;font-size:.62em;margin-bottom:6px}
  #craBig .row2{margin:10px 0}
  #craBig .row2 .lab{display:flex;justify-content:space-between;gap:10px;font-size:clamp(18px,2.6vw,30px);font-weight:700;margin-bottom:6px}
  #craBig .track{background:#1c1c22;border:1px solid #34343d;border-radius:12px;height:34px;overflow:hidden}
  #craBig .fill{height:100%;background:#2d6a96;min-width:2px;transition:width .4s}
  #craBig .row2.ans .fill{background:#1f9a4a}
  #craBig .row2.ans .lab{color:#75e38c}
  #craBig .row2.dim{opacity:.45}
  #craBig .row2.ans .lab{font-size:clamp(22px,3.2vw,38px)}
  #craBig .names{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
  #craBig .names span{background:#26262e;border-radius:99px;padding:2px 10px;font-size:15px}
  #craBig .empty{color:#a1a1aa;text-align:center;padding:60px 10px;font-size:22px}
  #craZoom{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
  #craZoom .box{max-width:min(1100px,94vw);max-height:92vh;overflow:auto;background:#1c1c22;border:1px solid #34343d;border-radius:22px;padding:28px 34px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;line-height:1.6;font-size:clamp(28px,4.4vw,56px)}
  #craBig .card.pic{white-space:normal;padding:10px}
  #craBig .card.pic img{width:100%;height:auto;display:block;background:#fff;border-radius:10px}
  #craZoom .box.pic{padding:16px;background:#1c1c22}
  #craZoom .box.pic img{max-width:100%;max-height:80vh;display:block;background:#fff;border-radius:10px;margin:auto}
  .cra-warn{margin:10px 0;padding:10px 12px;border:1px solid #f59e0b;border-radius:12px;background:#f59e0b18}
  .cra-warn .row{margin-top:6px}
  #craZoom small{display:block;color:#64d2ff;font-size:.4em;font-weight:800;margin-bottom:8px}
  `;

  function el(tag,props,...kids){
    const e=document.createElement(tag);
    if(props)for(const k in props){
      const v=props[k];
      if(k==='style')e.style.cssText=v;
      else if(k==='class')e.className=v;
      else if(k==='text')e.textContent=v;
      else if(k.startsWith('on'))e[k]=v;
      else if(v!==undefined&&v!==null)e.setAttribute(k,v);
    }
    for(const c of kids.flat())if(c!=null)e.append(c.nodeType?c:document.createTextNode(String(c)));
    return e;
  }

  // CSV: 엑셀에서 =,+,-,@ 로 시작하는 학생 글이 수식으로 실행되지 않게 앞에 ' 를 붙인다
  function csvCell(v){
    let s=String(v==null?'':v);
    if(/^[=+\-@\t\r]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  function download(name,rows){
    const csv='﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
    const a=el('a',{href:URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),download:name});
    document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
  }
  function stamp(d=new Date()){
    const p=n=>String(n).padStart(2,'0');
    return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());
  }
  function answerText(act,ans){
    if(!ans)return '';
    if(act.kind==='choice'){
      const i=ans.choice,cs=(act.config&&act.config.choices)||[];
      return typeof i==='number'?(MARK[i]||i+1)+' '+(cs[i]!=null?cs[i]:''):'';
    }
    if(isImg(act.kind))return (ans.drawn||ans.img)?(act.kind==='photo'?'(사진을 냄)':'(그림을 냄)'):'';
    return ans.text||'';
  }
  function correct(act,ans){
    if(act.kind!=='choice'||!act.config||typeof act.config.answer!=='number'||!ans)return '';
    return ans.choice===act.config.answer?'O':'X';
  }
  function rowsFor(act,responses){
    const base=[act.title,{text:'주관식',choice:'객관식',draw:'그림',photo:'사진',video:'영상'}[act.kind]||act.kind];
    if(!responses.length)return [[...base,'','','(낸 답 없음)','','']];
    return responses.map(r=>[...base,r.no,r.name,answerText(act,r.answer),correct(act,r.answer),r.updated_at?new Date(r.updated_at).toLocaleTimeString('ko-KR'):'']);
  }
  const CSV_HEAD=['활동','종류','번호','이름','답','정답 여부','낸 시각'];

  function newStep(kind){
    return kind==='choice'?{kind,title:'',choices:['',''],answer:null}
      :kind==='video'?{kind,title:'영상을 보고 생각해 봐요',url:''}
      :kind==='page'?{kind,title:'',url:''}:{kind,title:''};
  }

  const M={root:null,rpc:null,getRoom:null,isMock:false,command:null,timer:0,busy:false,
    flow:{id:null,title:'새 수업 흐름',steps:[]},flows:[],idx:-1,cur:null,big:false,anon:false,ui:{},keyFn:null};

  function say(text,bad){
    if(!M.ui.msg)return;
    M.ui.msg.textContent=text||'';
    M.ui.msg.style.color=bad?'var(--red)':'var(--sub)';
  }
  // 이름이 "테스트"(또는 test)로 시작하는 학생은 시험용으로 보고 제출 수·큰 화면·CSV·ZIP 에서 뺀다(🧪 버튼으로 포함할 수 있음).
  const isTest=n=>/^\s*(테스트|test)/i.test(String(n||''));
  function shape(name,d){
    try{
      if(name==='cra_admin_results'&&d&&Array.isArray(d.responses)){
        d.test=d.responses.filter(r=>isTest(r.name)).length;
        if(!M.incTest){d.responses=d.responses.filter(r=>!isTest(r.name));d.joined=Math.max(0,(d.joined||0)-(d.joined_test||0));d.ready=Math.max(0,(d.ready||0)-(d.ready_test||0))}
      }else if(name==='cra_admin_export'&&Array.isArray(d)&&!M.incTest){
        d.forEach(a=>{if(Array.isArray(a.responses))a.responses=a.responses.filter(r=>!isTest(r.name))});
      }
    }catch(_){}
    return d;
  }
  async function call(name,args){
    try{return await M.rpc(name,args)}
    catch(e){
      const m=String(e&&e.message||e);
      if(/cra_|PGRST202|Could not find the function/.test(m))say('수업 활동 기능이 아직 설정되지 않았어요. classroom/activity/schema.sql 을 Supabase 에서 한 번 실행해 주세요.',true);
      throw e;
    }
  }

  // ---------------------------------------------------------------- 화면 뼈대
  function mount(opt){
    M.root=opt.root;M.rpc=async(n,a)=>shape(n,await opt.rpc(n,a));M.getRoom=opt.getRoom;M.isMock=!!opt.isMock;M.command=opt.command;
    stop(true);
    M.root.replaceChildren();
    if(!document.getElementById('craStyle'))document.head.appendChild(el('style',{id:'craStyle'},CSS));
    const box=el('div',{class:'cra'});
    M.root.appendChild(box);
    box.append(el('b',{text:'📋 수업 활동'}),el('span',{class:'hint',style:'margin-left:8px',text:'주관식·객관식·영상을 학생 화면에 띄우고, 모두의 답을 큰 화면으로 봐요. 흐름을 저장해 두면 다음 수업에 불러올 수 있어요.'}));
    if(M.isMock){
      box.appendChild(el('div',{class:'hint',style:'margin-top:8px',text:'🧪 모의실험 중에는 사용할 수 없어요. [🚀 수업방 열기]로 실제 수업방을 열면 나타나요.'}));
      return;
    }
    const U=M.ui={};
    U.sel=el('select',{style:'min-width:170px'});
    U.sort=el('select',{title:'목록 정렬',onchange:()=>{M.sortBy=U.sort.value;loadFlows().catch(()=>{})}},
      el('option',{value:'recent',text:'최근 사용순'}),el('option',{value:'name',text:'이름순'}));
    U.sort.value=M.sortBy||'recent';
    U.title=el('input',{type:'text',maxlength:'60',placeholder:'수업 흐름 이름 (예: 분수 4단원 1차시)',oninput:()=>{M.flow.title=U.title.value}});
    U.bar=el('div',{class:'cra-flowbar'},
      U.sort,U.sel,
      el('button',{type:'button',text:'불러오기',onclick:loadSelected}),
      U.title,
      el('button',{type:'button',class:'primary',text:'💾 저장',onclick:()=>saveFlow(false)}),
      el('button',{type:'button',text:'다른 이름으로 저장',title:'지금 흐름을 복사해 새 이름으로 저장해요(원래 흐름은 그대로)',onclick:()=>saveFlow(true)}),
      el('button',{type:'button',text:'새로 만들기',onclick:newFlow}),
      el('button',{type:'button',class:'danger',text:'삭제',onclick:delFlow}),
      el('button',{type:'button',text:'⬇ 파일로 내보내기',title:'지금 흐름을 .json 파일로 저장해요',onclick:exportFlow}),
      el('button',{type:'button',text:'⬆ 파일에서 가져오기',title:'내보낸 .json 파일을 불러와요',onclick:importFlow}));
    U.steps=el('div');
    U.add=el('div',{class:'row',style:'margin:8px 0'},
      el('span',{class:'muted',text:'단계 추가:'}),
      ...['text','choice','draw','photo','video','page'].map(k=>el('button',{type:'button',text:'+ '+KINDS[k],onclick:()=>{M.flow.steps.push(newStep(k));renderSteps()}})));
    U.pos=el('span',{class:'muted'});
    U.run=el('div',{class:'row',style:'margin:8px 0'},
      el('button',{type:'button',class:'primary',text:'▶ 처음부터',onclick:startFlow}),
      el('button',{type:'button',text:'다음 단계 ▶',onclick:()=>runStep(M.idx+1)}),
      U.pos);
    U.live=el('div');
    U.msg=el('div',{class:'status',role:'status'});
    U.all=el('div',{class:'row'},
      el('button',{type:'button',text:'⬇ 오늘 수업 전체 CSV 저장',onclick:exportAll}),
      el('button',{type:'button',text:'⬇ 오늘 수업 전체 ZIP (그림·사진 포함)',onclick:exportAllZip}),
      el('span',{class:'hint',text:'오늘 낸 모든 활동과 답을 한 파일로 받아요(엑셀에서 열려요).'}));
    U.warn=el('div');U.ready=el('div',{class:'hint'});
    box.append(U.ready,U.warn,U.bar,U.steps,U.add,U.run,U.live,U.all,U.msg);
    renderSteps();renderLive();
    loadFlows().catch(()=>{});
    loadUnsaved();
    refresh();
    M.timer=setInterval(refresh,POLL_MS);
    M.tick=setInterval(tick,500);
    M.keyFn=e=>{
      if(e.key!=='Escape')return;
      if(document.getElementById('craZoom'))closeZoom();
      else if(M.big)closeBig();
    };
    document.addEventListener('keydown',M.keyFn);
  }

  function stop(quiet){
    clearInterval(M.timer);M.timer=0;clearInterval(M.tick);M.tick=0;M.deadline=null;
    if(M.keyFn){document.removeEventListener('keydown',M.keyFn);M.keyFn=null}
    closeBig();
    if(!quiet&&M.root)M.root.replaceChildren();
  }

  // ---------------------------------------------------------------- 수업 흐름 저장/불러오기
  async function loadFlows(){
    M.flows=await call('cra_admin_flows_list',{})||[];
    const U=M.ui;
    const md=t=>{if(!t)return '';const d=new Date(t);return isNaN(d)?'':(d.getMonth()+1)+'/'+d.getDate()};
    const shown=M.flows.slice();
    if((M.sortBy||'recent')==='name')shown.sort((a,b)=>String(a.title).localeCompare(String(b.title),'ko'));
    U.sel.replaceChildren(el('option',{value:'',text:M.flows.length?'— 저장된 수업 흐름 —':'(저장된 흐름이 없어요)'}),
      ...shown.map(f=>{
        const used=md(f.last_used_at),made=md(f.updated_at);
        return el('option',{value:f.id,text:f.title+' ('+((f.steps||[]).length)+'단계 · '+(used?'사용 '+used:'저장 '+made)+')'});
      }));
    if(M.flow.id)U.sel.value=M.flow.id;
    U.title.value=M.flow.title;
  }
  // ▶ 처음부터: 저장된 흐름이면 "마지막 사용일"을 기록해 목록의 최근 사용순에 반영한다.
  async function startFlow(){
    await runStep(0);
    if(M.flow.id){
      try{await M.rpc('cra_admin_flow_touch',{p_id:M.flow.id});const f=M.flows.find(x=>x.id===M.flow.id);if(f)f.last_used_at=new Date().toISOString();loadFlows().catch(()=>{})}catch(_){}
    }
  }
  function loadSelected(){
    const f=M.flows.find(x=>x.id===M.ui.sel.value);
    if(!f){say('불러올 수업 흐름을 먼저 골라 주세요.',true);return}
    if(M.flow.steps.length&&!confirm('지금 편집 중인 내용이 사라져요. 불러올까요?'))return;
    M.flow={id:f.id,title:f.title,steps:JSON.parse(JSON.stringify(f.steps||[]))};
    M.idx=-1;
    M.ui.title.value=M.flow.title;
    renderSteps();say('"'+f.title+'" 흐름을 불러왔어요. [▶ 처음부터]로 시작해요.');
  }
  async function saveFlow(asNew){
    const title=(M.ui.title.value||'').trim();
    if(!title){say('수업 흐름 이름을 적어 주세요.',true);return}
    if(asNew===true){
      if(M.flows.some(f=>f.title===title)&&!confirm('같은 이름의 수업 흐름이 이미 있어요. 그래도 새로 저장할까요?'))return;
      M.flow.id=null;
    }
    M.flow.title=title;
    try{
      const steps=M.flow.steps.map(cleanStep);
      const id=await call('cra_admin_flow_save',{p_id:M.flow.id,p_title:title,p_steps:steps});
      M.flow.id=id;
      await loadFlows();
      say('💾 "'+title+'" 저장했어요.');
    }catch(e){say('저장하지 못했어요: '+String(e.message||e).slice(0,120),true)}
  }
  async function delFlow(){
    const id=M.ui.sel.value||M.flow.id;
    const f=M.flows.find(x=>x.id===id);
    if(!f){say('삭제할 수업 흐름을 먼저 골라 주세요.',true);return}
    if(!confirm('"'+f.title+'" 수업 흐름을 삭제할까요? 되돌릴 수 없어요.'))return;
    try{
      await call('cra_admin_flow_delete',{p_id:id});
      if(M.flow.id===id)M.flow.id=null;
      await loadFlows();say('삭제했어요.');
    }catch(e){say('삭제하지 못했어요: '+String(e.message||e).slice(0,120),true)}
  }
  function exportFlow(){
    if(!M.flow.steps.length){say('내보낼 단계가 없어요.',true);return}
    const data={app:'classroom-activity-flow',version:1,title:M.flow.title||'수업 흐름',steps:M.flow.steps.map(cleanStep)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,1)],{type:'application/json'}));
    const a=el('a',{href:url,download:(M.flow.title||'수업흐름').replace(/[\\/:*?"<>|]+/g,'_')+'.json'});
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    say('파일로 저장했어요.');
  }
  function importFlow(){
    const inp=el('input',{type:'file',accept:'.json,application/json'});
    inp.onchange=async()=>{
      const f=inp.files&&inp.files[0];if(!f)return;
      try{
        if(f.size>200000)throw new Error('big');
        const d=JSON.parse(await f.text());
        if(!d||d.app!=='classroom-activity-flow'||!Array.isArray(d.steps))throw new Error('format');
        const steps=d.steps.slice(0,40).filter(x=>x&&KINDS[x.kind]).map(cleanStep);
        if(!steps.length)throw new Error('empty');
        if(M.flow.steps.length&&!confirm('지금 편집 중인 내용이 사라져요. 가져올까요?'))return;
        M.flow={id:null,title:String(d.title||'가져온 수업 흐름').slice(0,60),steps};M.idx=-1;
        M.ui.title.value=M.flow.title;M.ui.sel.value='';
        renderSteps();say('"'+M.flow.title+'" '+steps.length+'단계를 가져왔어요. 이름을 확인하고 💾 저장하세요.');
      }catch(_){say('가져올 수 없는 파일이에요. 이 화면에서 내보낸 .json 파일만 가져올 수 있어요.',true)}
    };
    inp.click();
  }
  function newFlow(){
    if(M.flow.steps.length&&!confirm('지금 편집 중인 내용이 사라져요. 새로 만들까요?'))return;
    M.flow={id:null,title:'새 수업 흐름',steps:[]};M.idx=-1;
    M.ui.title.value=M.flow.title;M.ui.sel.value='';
    renderSteps();say('');
  }
  function cleanStep(s){
    const o={kind:s.kind,title:String(s.title||'').slice(0,300)};
    if(s.kind==='choice'){
      const keep=[];(s.choices||[]).slice(0,6).forEach((x,k)=>{const t=String(x||'').trim();if(t)keep.push([k,t])});
      o.choices=keep.map(x=>x[1]);
      const at=typeof s.answer==='number'?keep.findIndex(x=>x[0]===s.answer):-1;
      o.answer=at>=0?at:null;
    }
    if(s.kind==='video'||s.kind==='page')o.url=String(s.url||'').trim().slice(0,500);
    const note=String(s.note||'').trim().slice(0,300);if(note)o.note=note;
    const sec=Number(s.seconds);if((s.kind==='text'||s.kind==='choice'||isImg(s.kind))&&sec>=10&&sec<=3600)o.seconds=Math.round(sec);
    return o;
  }

  // ---------------------------------------------------------------- 단계 편집
  function renderSteps(){
    const U=M.ui;
    U.steps.replaceChildren();
    if(!M.flow.steps.length){
      U.steps.appendChild(el('div',{class:'hint',style:'margin:8px 0',text:'아직 단계가 없어요. 아래 [+ 단계 추가]로 오늘 수업의 순서를 만들어 보세요. 저장하지 않고 바로 ▶ 시작해도 돼요.'}));
    }
    M.flow.steps.forEach((s,i)=>U.steps.appendChild(stepView(s,i)));
    U.pos.textContent=M.idx>=0?'지금 '+(M.idx+1)+' / '+M.flow.steps.length+' 단계':'';
  }
  function stepView(s,i){
    const box=el('div',{class:'cra-step'+(i===M.idx?' run':'')});
    const kindSel=el('select',{onchange:()=>{
      const ns=newStep(kindSel.value);ns.title=s.title&&kindSel.value!=='video'?s.title:ns.title;
      M.flow.steps[i]=ns;renderSteps();
    }},...Object.keys(KINDS).map(k=>el('option',{value:k,text:KINDS[k],...(k===s.kind?{selected:''}:{})})));
    const ph=s.kind==='page'?'학생 화면에 열 페이지 주소 (예: /fraction.html)':s.kind==='video'?'영상 앞에서 학생에게 보일 말':s.kind==='draw'?'그릴 주제 (예: 우리 동네를 그려요)':s.kind==='photo'?'찍을 것 (예: 내가 만든 작품을 찍어요 — 얼굴은 나오지 않게)':'문제 (학생 화면에 크게 보여요)';
    const titleIn=el('input',{type:'text',class:'t',maxlength:'300',placeholder:s.kind==='page'?'(선택) 이 단계의 이름':ph,value:s.title||'',oninput:()=>{s.title=titleIn.value}});
    box.appendChild(el('div',{class:'top'},
      el('span',{class:'no',text:(i+1)+'.'}),kindSel,titleIn,
      el('button',{type:'button',class:'mini',text:'▲',title:'위로',onclick:()=>move(i,-1)}),
      el('button',{type:'button',class:'mini',text:'▼',title:'아래로',onclick:()=>move(i,1)}),
      el('button',{type:'button',class:'mini',text:'복제',title:'이 단계를 복사해 바로 아래에 붙여요',onclick:()=>{M.flow.steps.splice(i+1,0,JSON.parse(JSON.stringify(s)));if(M.idx>i)M.idx++;renderSteps()}}),
      el('button',{type:'button',class:'mini danger',text:'삭제',onclick:()=>{M.flow.steps.splice(i,1);if(M.idx>=i)M.idx=Math.max(-1,M.idx-1);renderSteps()}}),
      el('button',{type:'button',class:'mini primary',text:'▶ 시작',onclick:()=>runStep(i)})));
    if(s.kind==='choice'){
      if(!Array.isArray(s.choices)||!s.choices.length)s.choices=['',''];
      const list=el('div',{class:'cra-choices'});
      const note=el('div',{class:'hint'});
      function paint(){
        list.replaceChildren();
        s.choices.forEach((c,k)=>{
          const rb=el('input',{type:'radio',name:'cra-ans-'+i,title:'이 보기를 정답으로'});
          rb.checked=s.answer===k;
          rb.onclick=()=>{if(s.answer===k){s.answer=null;rb.checked=false}else s.answer=k;paint()};
          const inp=el('input',{type:'text',maxlength:'100',placeholder:MARK[k]+'번 보기',value:c||'',oninput:()=>{s.choices[k]=inp.value}});
          list.appendChild(el('div',{class:'cra-crow'+(s.answer===k?' ans':'')},
            el('span',{class:'no',text:MARK[k]}),inp,
            el('label',{class:'muted',title:'정답으로 고르기'},rb,s.answer===k?' 정답':' 정답?'),
            el('button',{type:'button',class:'mini danger',text:'×',title:'이 보기 지우기',onclick:()=>{
              if(s.choices.length<=2){say('보기는 2개 이상 있어야 해요.',true);return}
              s.choices.splice(k,1);
              if(s.answer===k)s.answer=null;else if(typeof s.answer==='number'&&s.answer>k)s.answer--;
              paint();
            }})));
        });
        if(s.choices.length<6)list.appendChild(el('button',{type:'button',class:'mini',text:'+ 보기 추가',onclick:()=>{s.choices.push('');paint()}}));
        note.textContent=s.answer===null||s.answer===undefined?'정답을 고르지 않으면 "의견 묻기"로 진행돼요.':'정답은 [정답·결과 공개]를 누르기 전에는 학생에게 보이지 않아요.';
      }
      paint();
      box.append(list,note);
    }
    if(s.kind==='video'||s.kind==='page'){
      const u=el('input',{type:'text',style:'width:100%;margin-top:8px',placeholder:s.kind==='video'?'영상 주소 (https:// 로 시작, 유튜브는 화면 안에서 바로 재생)':'홈페이지 안의 주소 (예: /fraction.html)',value:s.url||'',oninput:()=>{s.url=u.value}});
      box.appendChild(u);
    }
    const extra=el('div',{class:'sub'});
    if(s.kind==='text'||s.kind==='choice'||isImg(s.kind)){
      const tsel=el('select',{onchange:()=>{s.seconds=tsel.value?Number(tsel.value):null}},
        ...[['','시간 제한 없음'],['30','30초'],['60','1분'],['120','2분'],['180','3분'],['300','5분'],['600','10분']].map(([v,t])=>el('option',{value:v,text:t})));
      tsel.value=s.seconds?String(s.seconds):'';
      if(s.seconds&&tsel.value==='')tsel.appendChild(el('option',{value:String(s.seconds),text:s.seconds+'초',selected:''}));
      extra.append(el('span',{class:'muted',text:'⏱'}),tsel);
    }
    const memo=el('input',{type:'text',maxlength:'300',placeholder:'📝 교사 메모 (학생에게는 안 보여요: 발문, 예상 답, 시간 등)',value:s.note||'',style:'flex:1;min-width:200px',oninput:()=>{s.note=memo.value}});
    extra.appendChild(memo);
    box.appendChild(extra);
    if(s.kind==='photo')box.appendChild(el('div',{class:'hint',text:'📷 학기 초에 받은 초상권 동의 범위 안에서만 쓰세요. 학생 화면에는 "얼굴·이름이 나오지 않았어요" 확인이 뜨고, 사진은 7일 뒤 자동으로 지워져요.'}));
    return box;
  }
  function move(i,d){
    const j=i+d,a=M.flow.steps;
    if(j<0||j>=a.length)return;
    [a[i],a[j]]=[a[j],a[i]];
    if(M.idx===i)M.idx=j;else if(M.idx===j)M.idx=i;
    renderSteps();
  }

  // ---------------------------------------------------------------- 단계 실행
  async function runStep(i){
    const steps=M.flow.steps;
    if(!steps.length){say('먼저 단계를 하나 이상 만들어 주세요.',true);return}
    if(i>=steps.length){say('마지막 단계였어요. 수고하셨어요!');return}
    if(i<0)i=0;
    const s=cleanStep(steps[i]),room=M.getRoom();
    if(!room){say('수업방이 열려 있지 않아요.',true);return}
    try{
      if(s.kind==='page'){
        let target;
        try{
          const u=new URL(s.url,location.href);
          if(u.origin!==location.origin)throw 0;
          target=u.pathname+u.search;
        }catch(_){say('홈페이지 안의 주소만 열 수 있어요 (예: /fraction.html).',true);return}
        await M.command('navigate',{url:target});
        M.idx=i;renderSteps();say((i+1)+'단계: 학생 화면에서 '+target+' 을(를) 열었어요.');
        return;
      }
      if(!s.title&&s.kind!=='video'){say('문제를 적어 주세요.',true);return}
      let cfg={};
      if(s.kind==='choice'){
        if(s.choices.length<2){say('보기를 2개 이상 적어 주세요.',true);return}
        cfg={choices:s.choices};if(typeof s.answer==='number'&&s.answer<s.choices.length)cfg.answer=s.answer;
      }
      if(s.seconds&&(s.kind==='text'||s.kind==='choice'||isImg(s.kind)))cfg.seconds=s.seconds;
      if(s.kind==='video'){
        if(!/^https:\/\//i.test(s.url)){say('영상 주소는 https:// 로 시작해야 해요.',true);return}
        cfg={url:s.url};
      }
      await call('cra_admin_open',{p_room:room,p_kind:s.kind,p_title:s.title||'영상을 같이 봐요',p_config:cfg});
      M.idx=i;renderSteps();
      say('▶ '+(i+1)+'단계를 학생 화면에 띄웠어요.'+(s.seconds?' ('+fmtSec(s.seconds)+' 뒤 자동 마감)':''));
      M.deadline=null;M.showBars=false;M.memo=s.note||'';
      await refresh();
      if(s.seconds&&M.cur&&M.cur.activity)M.deadline={id:M.cur.activity.id,end:Date.now()+s.seconds*1000};
    }catch(e){say('시작하지 못했어요: '+String(e.message||e).slice(0,140),true)}
  }

  // ---------------------------------------------------------------- 진행 현황
  async function refresh(){
    if(M.busy||M.isMock||!M.root)return;
    const room=M.getRoom();if(!room)return;
    M.busy=true;
    try{
      M.cur=await M.rpc('cra_admin_results',{p_room:room});
      showReady(M.cur);
      const ca=M.cur&&M.cur.activity;
      if(M.big&&ca&&isImg(ca.kind)){
        const sig=ca.id+'|'+M.cur.responses.map(r=>r.student_id+r.updated_at).join(',');
        if(sig!==M.imgSig){
          const full=await M.rpc('cra_admin_results',{p_room:room,p_activity:ca.id,p_images:true});
          M.imgs={};(full.responses||[]).forEach(r=>{if(r.answer&&r.answer.img)M.imgs[r.student_id]=r.answer.img});
          M.imgSig=sig;
        }
      }
      renderLive();
      if(M.big)renderBig();
    }catch(_){}
    finally{M.busy=false}
  }
  function tally(act,responses){
    const n=((act.config&&act.config.choices)||[]).length,c=Array(n).fill(0);
    responses.forEach(r=>{const k=r.answer&&r.answer.choice;if(typeof k==='number'&&k<n)c[k]++});
    return c;
  }
  function renderLive(){
    const U=M.ui;if(!U.live)return;
    U.live.replaceChildren();
    const d=M.cur,a=d&&d.activity;
    if(!a){U.live.appendChild(el('div',{class:'hint',style:'margin:8px 0',text:'지금 열려 있는 활동이 없어요. 위에서 [▶ 시작]을 눌러 보세요.'}));return}
    const open=a.status==='open';
    const box=el('div',{class:'cra-live'});
    box.appendChild(el('div',{class:'row'},
      el('span',{class:'cra-chip'+(open?'':' closed'),text:open?'진행 중':a.reveal?'공개됨':'마감'}),
      el('b',{text:KINDS[a.kind]||a.kind}),
      el('span',{style:'flex:1;min-width:200px;white-space:pre-wrap;word-break:break-word',text:a.title}),
      a.kind!=='video'?el('b',{text:'제출 '+d.responses.length+' / '+d.joined+'명'}):el('span',{class:'muted',text:'학생 화면에서 영상을 보고 있어요'})));
    if(a.kind==='choice'){
      const c=tally(a,d.responses),max=Math.max(1,...c),ans=a.config&&a.config.answer;
      const bars=el('div',{class:'cra-bars'});
      ((a.config&&a.config.choices)||[]).forEach((t,i)=>bars.appendChild(el('div',{class:'cra-bar'+(ans===i?' ans':'')},
        el('i',{style:'width:'+Math.round(100*c[i]/max)+'%'}),el('span',{text:(MARK[i]||i+1)+' '+t+(ans===i?'  ✔ 정답':'')+'  —  '+c[i]+'명'}))));
      box.appendChild(bars);
    }
    if(open&&M.deadline&&M.deadline.id===a.id)box.appendChild(el('div',{class:'cra-timer',id:'craTimer',text:''}));
    if(M.idx>=0&&M.memo&&open)box.appendChild(el('div',{class:'hint',style:'margin-top:6px',text:'📝 '+M.memo}));
    const btns=el('div',{class:'row',style:'margin-top:10px'});
    if(a.kind!=='video')btns.appendChild(el('button',{type:'button',class:'primary',text:'🖥 큰 화면으로 보기',onclick:openBig}));
    if(d.test>0||M.incTest)btns.appendChild(el('button',{type:'button',title:'이름이 "테스트"로 시작하는 학생은 시험용으로 보고 집계에서 빼요',text:M.incTest?'🧪 테스트 학생 포함 중 (누르면 제외)':'🧪 테스트 학생 '+d.test+'명 제외됨 (누르면 포함)',onclick:()=>{M.incTest=!M.incTest;M.imgSig='';refresh()}}));
    if(open)btns.appendChild(el('button',{type:'button',text:'⏹ 마감하기',onclick:()=>closeAct(a)}));
    if(a.kind==='choice')btns.appendChild(el('button',{type:'button',text:a.reveal?'정답·결과 숨기기':'📣 정답·결과 공개',onclick:()=>reveal(a,!a.reveal)}));
    if(isImg(a.kind))btns.appendChild(el('button',{type:'button',title:'학생 화면에 이름 없이 작품을 모아 보여 줘요(마감도 함께 돼요)',text:a.reveal?'🙈 친구들에게 공개 끄기':'📣 친구들에게 공개',onclick:()=>reveal(a,!a.reveal)}));
    if(isImg(a.kind))btns.appendChild(el('button',{type:'button',text:a.saved_at?'⬇ ZIP 다시 저장':'⬇ '+(a.kind==='photo'?'사진':'그림')+' ZIP 저장',onclick:()=>saveDrawZip(a.id)}));
    else if(a.kind!=='video')btns.appendChild(el('button',{type:'button',text:'⬇ 이 활동 CSV',onclick:exportOne}));
    if(!open&&a.kind==='video')btns.appendChild(el('span',{class:'hint',text:'영상은 다음 단계를 시작하면 학생 화면에서 사라져요.'}));
    box.appendChild(btns);
    U.live.appendChild(box);
  }
  function fmtSec(n){return n>=60?Math.floor(n/60)+'분'+(n%60?' '+(n%60)+'초':''):n+'초'}
  function tick(){
    const d=M.deadline;if(!d)return;
    const t=document.getElementById('craTimer');
    const left=Math.ceil((d.end-Date.now())/1000);
    if(t)t.textContent='⏱ 남은 시간 '+(left>0?fmtSec(left):'0초');
    if(left<=0){
      M.deadline=null;
      const a=M.cur&&M.cur.activity;
      if(a&&a.id===d.id&&a.status==='open')closeAct(a).then(()=>say('⏱ 시간이 다 되어 자동으로 마감했어요.'));
    }
  }
  async function closeAct(a){
    try{await call('cra_admin_close',{p_room:M.getRoom(),p_activity:a.id});say('마감했어요.');await refresh()}
    catch(e){say('마감하지 못했어요.',true)}
  }
  async function reveal(a,on){
    try{await call('cra_admin_reveal',{p_room:M.getRoom(),p_activity:a.id,p_reveal:on});say(on?(isImg(a.kind)?'작품을 이름 없이 학생 화면에 공개했어요(마감도 함께 됐어요).':'정답·결과를 학생 화면에 공개했어요(마감도 함께 됐어요).'):(isImg(a.kind)?'공개를 껐어요.':'정답·결과를 다시 숨겼어요.'));await refresh()}
    catch(e){say('바꾸지 못했어요.',true)}
  }

  // ---------------------------------------------------------------- 큰 화면
  function openBig(){
    if(!M.cur||!M.cur.activity)return;
    M.big=true;M.imgSig='';renderBig();refresh();
  }
  function closeBig(){
    M.big=false;
    ['craZoom','craBig'].forEach(id=>{const x=document.getElementById(id);if(x)x.remove()});
  }
  function closeZoom(){const z=document.getElementById('craZoom');if(z)z.remove()}
  function zoom(label,text){
    closeZoom();
    const z=el('div',{id:'craZoom',onclick:closeZoom},el('div',{class:'box'},el('small',{text:label}),document.createTextNode(text)));
    document.body.appendChild(z);
  }
  function zoomImg(label,src){
    closeZoom();
    const im=el('img',{alt:'학생 그림'});im.src=src;
    const z=el('div',{id:'craZoom',onclick:closeZoom},el('div',{class:'box pic'},el('small',{text:label}),im));
    document.body.appendChild(z);
  }
  function renderBig(){
    const d=M.cur,a=d&&d.activity;
    let big=document.getElementById('craBig');
    if(!a){closeBig();return}
    if(!big){big=el('div',{id:'craBig'});document.body.appendChild(big)}
    const keepScroll=big.querySelector('.bd')?big.querySelector('.bd').scrollTop:0;
    big.replaceChildren();
    const open=a.status==='open';
    const hd=el('div',{class:'hd'},
      el('div',{class:'q',text:a.title}),
      el('span',{class:'st',text:(open?'● 진행 중  ':'■ 마감  ')+'제출 '+d.responses.length+' / '+d.joined+'명'}),
      el('button',{type:'button',text:M.anon?'이름 보이기':'이름 가리기',onclick:()=>{M.anon=!M.anon;renderBig()}}),
      open?el('button',{type:'button',text:'⏹ 마감',onclick:()=>closeAct(a)}):null,
      a.kind==='choice'&&!a.reveal?el('button',{type:'button',text:M.showBars?'📊 막대 숨기기':'📊 막대 미리 보기',onclick:()=>{M.showBars=!M.showBars;renderBig()}}):null,
      a.kind==='choice'?el('button',{type:'button',text:a.reveal?'결과 숨기기':'📣 정답·결과 공개',onclick:()=>reveal(a,!a.reveal)}):null,
      isImg(a.kind)?el('button',{type:'button',text:a.reveal?'🙈 공개 끄기':'📣 친구들에게 공개',onclick:()=>reveal(a,!a.reveal)}):null,
      isImg(a.kind)?el('button',{type:'button',text:'⬇ ZIP',onclick:()=>saveDrawZip(a.id)}):el('button',{type:'button',text:'⬇ CSV',onclick:exportOne}),
      el('button',{type:'button',class:'primary',text:'✕ 닫기 (Esc)',onclick:closeBig}));
    const bd=el('div',{class:'bd'});
    const rs=d.responses;
    const who=(r,i)=>M.anon?'친구 '+(i+1):r.no+'번 '+r.name;
    if(!rs.length){
      bd.appendChild(el('div',{class:'empty',text:open?'아직 낸 친구가 없어요. 잠시만 기다려 주세요…':'낸 답이 없어요.'}));
    }else if(a.kind==='text'){
      const n=rs.length,fs=n<=4?34:n<=8?28:n<=14?23:n<=24?19:16,cw=n<=4?420:n<=8?340:n<=14?290:240;
      const cards=el('div',{class:'cards',style:'--fs:'+fs+'px;--cw:'+cw+'px'});
      rs.forEach((r,i)=>{
        const t=(r.answer&&r.answer.text)||'';
        const c=el('div',{class:'card',onclick:()=>zoom(who(r,i),t)},el('small',{text:who(r,i)}),document.createTextNode(t));
        cards.appendChild(c);
      });
      bd.appendChild(cards);
    }else if(isImg(a.kind)){
      const n=rs.length,cw=n<=2?560:n<=6?400:n<=12?300:230;
      const cards=el('div',{class:'cards',style:'--cw:'+cw+'px'});
      rs.forEach((r,i)=>{
        const src=M.imgs&&M.imgs[r.student_id];
        const c=el('div',{class:'card pic',onclick:()=>src&&zoomImg(who(r,i),src)},el('small',{text:who(r,i)}));
        if(src&&/^data:image\/(jpeg|png|webp);base64,/.test(src)){const im=el('img',{alt:'학생 그림'});im.src=src;c.appendChild(im)}
        else c.appendChild(el('div',{class:'muted',text:'그림 불러오는 중…'}));
        cards.appendChild(c);
      });
      bd.appendChild(cards);
    }else if(a.kind==='choice'){
      // 정답은 교사가 [정답·결과 공개]를 누른 뒤에만 큰 화면에 나온다(앞에서 빔 프로젝터로 보고 있는 학생에게 새지 않게).
      // 공개 전에는 막대(남의 선택 분포)도 기본으로 가리고 "N명이 골랐어요"만 보여 준다. 📊 버튼으로 미리 볼 수 있다.
      const cs=(a.config&&a.config.choices)||[],c=tally(a,rs),total=c.reduce((x,y)=>x+y,0),max=Math.max(1,...c);
      const ans=a.reveal?(a.config&&a.config.answer):undefined;
      const bars=a.reveal||M.showBars;
      if(!bars)bd.appendChild(el('div',{class:'empty',text:'✋ '+total+'명이 골랐어요. 아직 결과는 비밀!'}));
      cs.forEach((t,i)=>{
        const hasAns=typeof ans==='number';
        const row=el('div',{class:'row2'+(ans===i?' ans':'')+(hasAns&&ans!==i?' dim':'')});
        const pct=total?Math.round(100*c[i]/total):0;
        row.appendChild(el('div',{class:'lab'},el('span',{text:(MARK[i]||i+1)+' '+t+(ans===i?'  ✔ 정답':'')}),el('span',{text:bars?c[i]+'명 · '+pct+'%':''})));
        if(bars){
          row.appendChild(el('div',{class:'track'},el('div',{class:'fill',style:'width:'+Math.round(100*c[i]/max)+'%'})));
          const names=el('div',{class:'names'});
          rs.forEach((r,k)=>{if(r.answer&&r.answer.choice===i&&!M.anon)names.appendChild(el('span',{text:r.no+'번 '+r.name}))});
          if(names.childNodes.length)row.appendChild(names);
        }
        bd.appendChild(row);
      });
    }
    big.append(hd,bd);
    bd.scrollTop=keepScroll;
  }

  // ---------------------------------------------------------------- 그림 ZIP 저장 (압축 없이 묶기: 이미지는 이미 줄여 있음)
  const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
  function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
  function zipBlob(files){
    const enc=new TextEncoder(),parts=[],cen=[];let off=0;
    const now=new Date(),dt=((now.getFullYear()-1980)<<9|(now.getMonth()+1)<<5|now.getDate()),tm=(now.getHours()<<11|now.getMinutes()<<5|(now.getSeconds()>>1));
    files.forEach(f=>{
      const nm=enc.encode(f.name),crc=crc32(f.bytes),n=f.bytes.length;
      const lh=new DataView(new ArrayBuffer(30));
      lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);
      lh.setUint16(10,tm,true);lh.setUint16(12,dt,true);lh.setUint32(14,crc,true);lh.setUint32(18,n,true);lh.setUint32(22,n,true);
      lh.setUint16(26,nm.length,true);lh.setUint16(28,0,true);
      parts.push(lh.buffer,nm,f.bytes);
      const ch=new DataView(new ArrayBuffer(46));
      ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);
      ch.setUint16(12,tm,true);ch.setUint16(14,dt,true);ch.setUint32(16,crc,true);ch.setUint32(20,n,true);ch.setUint32(24,n,true);
      ch.setUint16(28,nm.length,true);ch.setUint32(42,off,true);
      cen.push(ch.buffer,nm);
      off+=30+nm.length+n;
    });
    let csz=0;cen.forEach(x=>csz+=x.byteLength||x.length);
    const end=new DataView(new ArrayBuffer(22));
    end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,csz,true);end.setUint32(16,off,true);
    return new Blob([...parts,...cen,end.buffer],{type:'application/zip'});
  }
  function dataUrlBytes(u){
    const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(u||'');
    if(!m)return null;
    const bin=atob(m[2]),b=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)b[i]=bin.charCodeAt(i);
    return {ext:m[1]==='jpeg'?'jpg':m[1],bytes:b};
  }
  function safeName(x){return String(x||'').replace(/[\\/:*?"<>|\s]+/g,'_').slice(0,30)}
  async function saveDrawZip(actId){
    try{
      const room=M.getRoom();
      const full=await call('cra_admin_results',{p_room:room,p_activity:actId,p_images:true});
      const a=full.activity,files=[],list=[['번호','이름','파일','낸 시각']];
      (full.responses||[]).forEach(r=>{
        const im=dataUrlBytes(r.answer&&r.answer.img);if(!im)return;
        const fn=String(r.no).padStart(2,'0')+'_'+safeName(r.name)+'.'+im.ext;
        files.push({name:fn,bytes:im.bytes});
        list.push([r.no,r.name,fn,r.updated_at?new Date(r.updated_at).toLocaleString('ko-KR'):'']);
      });
      if(!files.length){say('저장할 그림이 아직 없어요.',true);return}
      const csv='\uFEFF'+list.map(r=>r.map(csvCell).join(',')).join('\r\n');
      files.push({name:'목록.csv',bytes:new TextEncoder().encode(csv)});
      const blob=zipBlob(files);
      const link=el('a',{href:URL.createObjectURL(blob),download:'그림_'+safeName(a.title).slice(0,20)+'_'+stamp()+'.zip'});
      document.body.appendChild(link);link.click();
      setTimeout(()=>{URL.revokeObjectURL(link.href);link.remove()},800);
      try{await M.rpc('cra_admin_mark_saved',{p_activity:actId})}catch(_){}
      say('🎨 그림 '+(files.length-1)+'장을 ZIP 으로 저장했어요. 다운로드 폴더를 확인하세요.');
      loadUnsaved();refresh();
    }catch(e){say('저장하지 못했어요: '+String(e.message||e).slice(0,120),true)}
  }
  // 학생 화면이 활동을 받을 준비가 됐는지(옛 화면 파일로 도는 학생 찾기)
  function showReady(d){
    const U=M.ui;if(!U||!U.ready||!d)return;
    const j=d.joined||0,r=Math.min(d.ready||0,j);
    if(!j){U.ready.textContent='';return}
    U.ready.style.color=r<j?'#f59e0b':'';
    U.ready.textContent='📝 활동을 받을 수 있는 학생 '+r+' / '+j+'명'+(r<j?' — 나머지 학생은 화면을 새로고침(다시 로그인)해야 활동이 떠요.':'');
  }
  async function loadUnsaved(){
    const U=M.ui;if(!U||!U.warn)return;
    try{
      const list=await M.rpc('cra_admin_unsaved',{});
      U.warn.replaceChildren();
      if(!list||!list.length)return;
      const soon=list.map(x=>x.expires_at?Math.max(0,Math.ceil((Date.parse(x.expires_at)-Date.now())/86400000)):7);
      const box=el('div',{class:'cra-warn'},el('b',{text:'🎨📷 아직 내려받지 않은 그림·사진 '+list.length+'개 — 가장 빠른 것은 '+Math.min(...soon)+'일 뒤 자동으로 지워져요.'}));
      const row=el('div',{class:'row'});
      list.forEach(x=>row.appendChild(el('button',{type:'button',text:'⬇ '+(x.title||'그림').slice(0,16)+' ('+x.count+'장)',onclick:()=>saveDrawZip(x.id)})));
      box.appendChild(row);U.warn.appendChild(box);
    }catch(_){}
  }

  // ---------------------------------------------------------------- CSV 저장
  function exportOne(){
    const d=M.cur,a=d&&d.activity;
    if(!a){say('저장할 활동이 없어요.',true);return}
    download('수업활동_'+stamp()+'.csv',[CSV_HEAD,...rowsFor(a,d.responses)]);
    say('이 활동의 답을 CSV 로 저장했어요.');
  }
  async function exportAll(){
    try{
      const since=new Date();since.setHours(0,0,0,0);
      const list=await call('cra_admin_export',{p_room:M.getRoom(),p_since:since.toISOString()});
      if(!list||!list.length){say('오늘 낸 활동이 아직 없어요.',true);return}
      const rows=[CSV_HEAD];
      list.filter(a=>a.kind!=='video').forEach(a=>rows.push(...rowsFor(a,a.responses||[])));
      download('수업활동_전체_'+stamp()+'.csv',rows);
      say('오늘 수업의 활동 '+list.length+'개를 CSV 로 저장했어요.');
    }catch(e){say('저장하지 못했어요: '+String(e.message||e).slice(0,120),true)}
  }

  // 오늘 수업 전체를 한 파일로: 전체결과.csv + 그림·사진 활동은 활동별 폴더에 이미지
  async function exportAllZip(){
    try{
      const room=M.getRoom();
      const since=new Date();since.setHours(0,0,0,0);
      const list=await call('cra_admin_export',{p_room:room,p_since:since.toISOString()});
      if(!list||!list.length){say('오늘 낸 활동이 아직 없어요.',true);return}
      const rows=[CSV_HEAD];
      list.filter(a=>a.kind!=='video').forEach(a=>rows.push(...rowsFor(a,a.responses||[])));
      const files=[{name:'전체결과.csv',bytes:new TextEncoder().encode('\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'))}];
      let pics=0;const savedIds=[];
      for(let i=0;i<list.length;i++){
        const a=list[i];
        if(!isImg(a.kind)||!(a.responses||[]).some(r=>r.answer&&r.answer.drawn))continue;
        const full=await call('cra_admin_results',{p_room:room,p_activity:a.id,p_images:true});
        const dir=String(i+1).padStart(2,'0')+'_'+safeName(a.title).slice(0,20)+'/';
        (full.responses||[]).forEach(r=>{
          const im=dataUrlBytes(r.answer&&r.answer.img);if(!im)return;
          files.push({name:dir+String(r.no).padStart(2,'0')+'_'+safeName(r.name)+'.'+im.ext,bytes:im.bytes});pics++;
        });
        savedIds.push(a.id);
      }
      const blob=zipBlob(files);
      const link=el('a',{href:URL.createObjectURL(blob),download:'수업활동_전체_'+stamp()+'.zip'});
      document.body.appendChild(link);link.click();
      setTimeout(()=>{URL.revokeObjectURL(link.href);link.remove()},800);
      for(const id of savedIds){try{await M.rpc('cra_admin_mark_saved',{p_activity:id})}catch(_){}}
      say('📦 오늘 수업의 활동 '+list.length+'개(그림·사진 '+pics+'장)를 ZIP 으로 저장했어요.');
      loadUnsaved();
    }catch(e){say('저장하지 못했어요: '+String(e.message||e).slice(0,120),true)}
  }

  window.ClassroomActivity={mount,stop,_state:M};
})();
