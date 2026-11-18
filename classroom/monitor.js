/* 접속 표시(우리 반 교실 연결): 같은 탭에 학생 로그인(st_s)이 있으면 어느 페이지에서든
   20초마다 서버(school-tool 함수)에 '여기 있어요'를 알려, 교사 화면에 접속 중으로 보이게 한다.
   - school-tool/index.html 은 자기 안에서 따로 알리므로 건너뛴다.
   - 실패해도 조용히 넘어가고 로그인을 지우거나 페이지를 옮기지 않는다.
   - 서버가 거절(401·403·429)하면 이 페이지에서는 더 보내지 않는다(잘못된 입력 잠금이 반 전체에 걸리는 것을 막기 위해). */
(()=>{
  'use strict';
  try{
    if(/\/school-tool\/(index\.html)?$/.test(location.pathname))return;
    const U='https://erzdvlcbjneabxqwnwfy.supabase.co',K='sb_publishable_29w26VjvhHwI5O6iKOXTwA_sSTKUhfz';
    const rd=()=>{try{return JSON.parse(sessionStorage.getItem('st_s')||'null')}catch(_){return null}};
    let busy=false,stopped=false,timer=0;
    const SELF1=(document.currentScript&&document.currentScript.src)||'';
    const state={msgs:[],dm:0,onUpdate:null};
    let whereP=null;
    function loadWhere(){
      if(window.__stWhere)return Promise.resolve();
      if(!whereP)whereP=new Promise(res=>{
        try{const sc=document.createElement('script');sc.src=SELF1?SELF1.replace(/monitor\.js(\?.*)?$/,'where.js'):'/classroom/where.js';sc.onload=sc.onerror=()=>res();document.head.appendChild(sc)}catch(_){res()}
      });
      return whereP;
    }
    const hidden=()=>{try{return localStorage.getItem('st_hide')==='1'}catch(_){return false}};
    async function token(){
      let s=rd();
      if(Date.now()<=(s.exp||0)-60000)return s.access;
      s=rd();   // 갱신 직전에 다시 읽어, 다른 스크립트가 방금 갱신한 값을 덮어쓰지 않게 한다
      if(Date.now()<=(s.exp||0)-60000)return s.access;
      const r=await fetch(U+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:K,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.access_token)return null;
      s={...s,access:j.access_token,refresh:j.refresh_token||s.refresh,exp:Date.now()+(j.expires_in||3600)*1000};
      try{sessionStorage.setItem('st_s',JSON.stringify(s))}catch(_){}
      return s.access;
    }
    async function ping(){
      if(busy||stopped)return;busy=true;
      try{
        const s=rd();if(!s||!s.num)return;   // 번호가 정해진(승인된) 로그인만
        let who;
        if(s.access){const j=await token();if(!j)return;who={jwt:j}}
        else if(s.name){who={number:s.num,name:s.name}}
        else return;
        const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),10000);
        try{
          await loadWhere();
          const wk=window.__stWhere?window.__stWhere.key():'';
          const r=await fetch(U+'/functions/v1/school-tool',{method:'POST',signal:ctl.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...who,action:'ping',visible:!document.hidden,where:wk,hide:hidden()})});
          if(r.status===401||r.status===403||r.status===429){stopped=true;clearInterval(timer)}
          else if(r.ok){try{const d=await r.json();state.msgs=d.messages||[];state.dm=d.dm_unread||0;if(state.onUpdate)state.onUpdate()}catch(_){}}
        }finally{clearTimeout(to)}
      }catch(_){}finally{busy=false}
    }
    /* 도움 신호 버튼: 로그인한 학생 화면 오른쪽 아래에 🙋 버튼. 누르면 선택한 말이 선생님 교실 연결 화면으로 간다. */
    function helpButton(){
      const s0=rd();if(!s0||!s0.num||/\/classroom\/teacher\.html/.test(location.pathname))return;
      const st=document.createElement('style');st.dataset.classroomUi='1';
      st.textContent='.hp-fab{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:9990;font:inherit}'
        +'.hp-fab>button.main{position:relative;width:54px;height:54px;border-radius:50%;border:0;background:#f59e0b;color:#fff;font-size:26px;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer}'
        +'.hp-menu{display:none;position:absolute;right:0;bottom:64px;background:#fff;color:#222;border-radius:16px;padding:8px;min-width:190px;box-shadow:0 8px 28px rgba(0,0,0,.35)}'
        +'.hp-fab.open .hp-menu{display:block}'
        +'.hp-menu button{display:block;width:100%;text-align:left;font:inherit;font-size:17px;font-weight:700;padding:12px 14px;border:0;background:none;border-radius:10px;cursor:pointer;color:#222}'
        +'.hp-menu button:active{background:#fef3c7}'
        +'.hp-toast{position:fixed;right:14px;bottom:80px;z-index:9991;background:#111;color:#fff;padding:10px 14px;border-radius:12px;font-size:15px;max-width:70vw}';
      document.head.appendChild(st);
      const box=document.createElement('div');box.className='hp-fab';box.dataset.classroomUi='1';
      const main=document.createElement('button');main.className='main';main.type='button';main.textContent='🙋';main.setAttribute('aria-label','선생님께 신호 보내기');
      const menu=document.createElement('div');menu.className='hp-menu';
      function toast(t){const d=document.createElement('div');d.className='hp-toast';d.dataset.classroomUi='1';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
      async function send(t){
        box.classList.remove('open');
        try{
          const s=rd();let who;
          if(s&&s.access){const j=await token();if(!j){toast('다시 로그인해 주세요.');return}who={jwt:j}}
          else if(s&&s.name){who={number:s.num,name:s.name}}
          else{toast('다시 로그인해 주세요.');return}
          const r=await fetch(U+'/functions/v1/school-tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...who,action:'send',body:t})});
          if(r.ok)toast('✅ 선생님께 보냈어요');
          else if(r.status===429)toast('잠깐 쉬었다가 다시 눌러 주세요');
          else toast('보내지 못했어요. 다시 해 보세요.');
        }catch(_){toast('보내지 못했어요. 다시 해 보세요.')}
      }
      ['🙋 도와주세요','❓ 질문 있어요','🚻 화장실 다녀올게요','✅ 다 했어요'].forEach(t=>{
        const b=document.createElement('button');b.type='button';b.textContent=t;
        b.onclick=()=>send(t.replace(/^\S+\s/,''));menu.appendChild(b);
      });
      /* 받은 메시지(선생님) · 친구와 이야기 · 내 접속 숨기기 */
      const sep=document.createElement('div');sep.style.cssText='height:1px;background:#e5e7eb;margin:6px 4px';menu.appendChild(sep);
      const inbox=document.createElement('button');inbox.type='button';menu.appendChild(inbox);
      const talk=document.createElement('button');talk.type='button';menu.appendChild(talk);
      const hide=document.createElement('button');hide.type='button';menu.appendChild(hide);
      const badge=document.createElement('span');badge.style.cssText='position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#dc2626;color:#fff;font:700 12px/20px system-ui;text-align:center;padding:0 5px;display:none';
      const panel=document.createElement('div');panel.dataset.classroomUi='1';panel.style.cssText='display:none;position:fixed;right:14px;bottom:80px;z-index:9992;width:min(92vw,360px);max-height:60vh;overflow:auto;background:#fff;color:#222;border-radius:16px;padding:12px;box-shadow:0 8px 28px rgba(0,0,0,.4);font:15px/1.5 system-ui,sans-serif';
      const seenKey='st_seen_ts';
      const seen=()=>{try{return Number(localStorage.getItem(seenKey)||0)}catch(_){return 0}};
      const fromTeacher=()=>(state.msgs||[]).filter(m=>m.direction==='to_student'||m.direction==='announce');
      const unreadT=()=>fromTeacher().filter(m=>new Date(m.created_at).getTime()>seen()).length;
      function refresh(){
        const nt=unreadT(),nd=state.dm||0,tot=nt+nd;
        inbox.textContent='📨 선생님 메시지'+(nt?' ('+nt+')':'');
        talk.textContent='💬 친구들과 이야기'+(nd?' ('+nd+')':'');
        hide.textContent=hidden()?'👀 내 접속 보이기':'🙈 내 접속 숨기기';
        badge.textContent=tot>9?'9+':String(tot);badge.style.display=tot?'block':'none';
      }
      state.onUpdate=refresh;
      inbox.onclick=()=>{
        box.classList.remove('open');panel.replaceChildren();
        const h=document.createElement('div');h.style.cssText='font-weight:800;margin-bottom:6px';h.textContent='📨 선생님이 보낸 메시지';panel.append(h);
        const list=fromTeacher().slice(0,10);
        if(!list.length){const e=document.createElement('div');e.style.color='#6b7280';e.textContent='아직 받은 메시지가 없어요.';panel.append(e)}
        list.forEach(m=>{
          const d=document.createElement('div');d.style.cssText='background:#f3f4f6;border-radius:10px;padding:8px 10px;margin:6px 0;white-space:pre-wrap;word-break:break-word';
          const t=document.createElement('div');t.style.cssText='font-size:12px;color:#6b7280';t.textContent=(m.direction==='announce'?'📢 우리 반 알림 · ':'💬 ')+new Date(m.created_at).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit'});
          const b=document.createElement('div');b.textContent=m.body;d.append(t,b);panel.append(d);
        });
        const c=document.createElement('button');c.type='button';c.textContent='닫기';c.style.cssText='margin-top:6px;border:0;border-radius:10px;padding:8px 14px;background:#e5e7eb;font:inherit;font-weight:700;cursor:pointer';c.onclick=()=>{panel.style.display='none'};panel.append(c);
        panel.style.display='block';
        try{localStorage.setItem(seenKey,String(Date.now()))}catch(_){}
        refresh();
      };
      talk.onclick=()=>{if(/\/school\.html$/.test(location.pathname)){location.hash='talk'}else location.href='/school.html#talk'};
      hide.onclick=()=>{
        try{localStorage.setItem('st_hide',hidden()?'0':'1')}catch(_){}
        box.classList.remove('open');refresh();
        toast(hidden()?'🙈 친구들에게 내 접속이 보이지 않아요':'👀 친구들에게 내 접속이 보여요');
        ping();
      };
      refresh();
      main.onclick=()=>{box.classList.toggle('open');panel.style.display='none'};
      main.append(badge);
      box.append(menu,main);document.body.appendChild(box);document.body.appendChild(panel);
    }
    if(!/\/school-tool\//.test(location.pathname)){
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',helpButton,{once:true});else helpButton();
    }
    if(rd()){
      setTimeout(ping,Math.random()*3000);   // 반 전체가 한꺼번에 몰리지 않게 조금 흩뜨린다
      timer=setInterval(ping,20000);
      document.addEventListener('visibilitychange',()=>{ping()});
    }
  }catch(_){}
})();
/* 학생 화면 상태 전송 및 교사 명령 수신.
   로그인한 학생(st_s)은 방 코드·번호를 따로 입력하지 않아도 된다: 교사가 수업을 시작해 둔 동안에만
   자동으로 입장하고(수업 코드 HC302), 수업이 없으면 30초마다 조용히 다시 확인한다. */
(()=>{
  'use strict';
  const U0='https://erzdvlcbjneabxqwnwfy.supabase.co',K0='sb_publishable_29w26VjvhHwI5O6iKOXTwA_sSTKUhfz';
  const SELF=(document.currentScript&&document.currentScript.src)||'';   // 같은 폴더의 모듈(activity/)을 찾는 기준
  let booted=false,retryTimer=0,dropHook=null;
  function readCfg(){try{return JSON.parse(localStorage.getItem('homeClassroom')||'null')}catch(_){return null}}
  function readLogin(){try{return JSON.parse(sessionStorage.getItem('st_s')||'null')}catch(_){return null}}
  async function autoJoin(){
    try{
      if(sessionStorage.getItem('cls_kicked'))return false;   // 선생님이 내보낸 탭은 다시 들어가지 않는다
      const s=readLogin();
      if(!s||!s.num||!s.name)return false;
      if(/\/school-tool\/|\/classroom\/teacher\.html/.test(location.pathname))return false;
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
      const r=await fetch(U0+'/rest/v1/rpc/classroom_student_join',{method:'POST',headers:{apikey:K0,Authorization:'Bearer '+K0,'Content-Type':'application/json'},body:JSON.stringify({p_room:'HC302',p_no:String(s.num),p_name:String(s.name),p_token:token})});
      if(!r.ok)return false;   // 수업이 열려 있지 않으면 조용히 넘어간다
      const d=await r.json();
      localStorage.setItem('homeClassroom',JSON.stringify({studentId:d.student_id,token,room:d.room_code||'HC302',name:s.name,no:s.num,mock:false,auto:true,joinedAt:Date.now()}));
      return true;
    }catch(_){return false}
  }
  function dropped(reason){if(dropHook)dropHook(reason||'ended')}
  /* 수업에 연결되어 있는지 학생이 항상 알 수 있게: 연결 안 됨 표시줄 + 끊겼을 때 사라지지 않는 안내 */
  let chipEl=null,noticeEl=null;
  function uiBase(el){el.dataset.classroomUi='1';el.setAttribute('data-keep-ui','1');return el}
  function hideNotices(){if(chipEl){chipEl.remove();chipEl=null}if(noticeEl){noticeEl.remove();noticeEl=null}}
  function showChip(text,onClick){
    if(!document.body)return;
    if(!chipEl){chipEl=uiBase(document.createElement('button'));chipEl.type='button';
      chipEl.style.cssText='position:fixed;z-index:2147483500;left:12px;bottom:12px;max-width:calc(100vw - 96px);padding:7px 12px;border-radius:12px;border:1px solid #ffffff35;background:#3f3f46ee;color:#fff;font:13px/1.4 system-ui,sans-serif;cursor:default;text-align:left';
      document.body.appendChild(chipEl)}
    chipEl.textContent=text;chipEl.style.cursor=onClick?'pointer':'default';chipEl.onclick=onClick||null;
  }
  function showNotice(text,btnText,onBtn){
    if(!document.body)return;
    if(noticeEl)noticeEl.remove();
    noticeEl=uiBase(document.createElement('div'));noticeEl.setAttribute('role','alert');
    noticeEl.style.cssText='position:fixed;z-index:2147483590;left:50%;top:14px;transform:translateX(-50%);width:min(92vw,520px);padding:14px 16px;border-radius:16px;background:#fff7ed;color:#7c2d12;border:2px solid #f59e0b;box-shadow:0 8px 28px #0006;font:700 16px/1.5 system-ui,sans-serif;text-align:center';
    const t=document.createElement('div');t.textContent=text;noticeEl.append(t);
    const row=document.createElement('div');row.style.cssText='margin-top:10px;display:flex;gap:8px;justify-content:center';
    if(btnText){const b=document.createElement('button');b.type='button';b.textContent=btnText;b.style.cssText='border:0;border-radius:10px;padding:9px 16px;background:#f59e0b;color:#fff;font:inherit;font-weight:800;cursor:pointer';b.onclick=()=>{onBtn&&onBtn()};row.append(b)}
    const ok=document.createElement('button');ok.type='button';ok.textContent='확인';ok.style.cssText='border:0;border-radius:10px;padding:9px 16px;background:#e5e7eb;color:#111;font:inherit;font-weight:700;cursor:pointer';ok.onclick=()=>{noticeEl&&noticeEl.remove();noticeEl=null};row.append(ok);
    noticeEl.append(row);document.body.appendChild(noticeEl);
  }
  function main(){
  if(booted)return;
  let cfg=readCfg();
  if(!cfg||!cfg.studentId)return;
  booted=true;hideNotices();
  cfg.room = cfg.room || 'HC302';

  const isMock=!!cfg.mock;
  const U='https://erzdvlcbjneabxqwnwfy.supabase.co',K='sb_publishable_29w26VjvhHwI5O6iKOXTwA_sSTKUhfz';
  const cursorKey='homeClassroomCursor:'+cfg.studentId;

  let cursor=Number(localStorage.getItem(cursorKey)||0);
  let busy=false,paused=false,stopped=false,focusLayer=null,bar=null,canvasBusy=false;
  let html2canvasPromise=null,lastScreenshot='',streamVideo=null,mediaStream=null;
  let mockChannel=null;

  function rpc(name,args){
    return fetch(U+'/rest/v1/rpc/'+name,{
      method:'POST',
      headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json'},
      body:JSON.stringify(args)
    }).then(async r=>{
      const t=await r.text();
      if(!r.ok)throw Error(t||r.status);
      return t?JSON.parse(t):null;
    });
  }

  function makeUi(){
    bar=document.createElement('div');
    bar.dataset.classroomUi='1';
    bar.setAttribute('data-html2canvas-ignore','true');
    bar.style.cssText='position:fixed;z-index:2147483600;left:12px;bottom:12px;max-width:calc(100vw - 96px);display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:12px;background:#14141beF;color:#fff;border:1px solid #ffffff35;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px #0007;flex-wrap:wrap';
    
    const tagText=isMock?'🧪 [모의실험] 수업 공유 중':'🟢 수업 화면 공유 중';
    bar.innerHTML='<span id="classroomBarStatus">'+tagText+'</span>'
      +'<button type="button" data-share="1" style="border:0;border-radius:8px;padding:5px 9px;cursor:pointer;background:#0a84ff;color:#fff;font-size:12px;font-weight:700" title="클래스툴 방식으로 탭을 직접 공유하여 고화질·실시간으로 전송합니다.">🎥 탭 직접 공유</button>'
      +'<button type="button" data-pause="1" style="border:0;border-radius:8px;padding:5px 9px;cursor:pointer;background:#2d2d38;color:#fff;font-size:12px">공유 일시정지</button>'
      +'<button type="button" data-leave="1" style="border:0;border-radius:8px;padding:5px 9px;cursor:pointer;background:#442323;color:#ff9f97;font-size:12px">나가기</button>';
    document.body.appendChild(bar);

    bar.addEventListener('click',async e=>{
      if(e.target.dataset.share){
        await startMediaShare();
      }
      if(e.target.dataset.pause){
        paused=!paused;
        e.target.textContent=paused?'공유 다시 켜기':'공유 일시정지';
        const st=bar.querySelector('#classroomBarStatus');
        if(st)st.textContent=paused?'🟠 화면 공유 일시 중지':tagText;
        send(false);
      }
      if(e.target.dataset.leave){
        if(confirm('수업 화면 공유를 끝내고 나갈까요?')){
          stopped=true;
          try{sessionStorage.setItem('cls_kicked','1')}catch(_){}
          if(mediaStream){
            mediaStream.getTracks().forEach(t=>t.stop());
          }
          if(isMock&&mockChannel){
            mockChannel.postMessage({type:'student_leave',studentId:cfg.studentId});
          }
          localStorage.removeItem('homeClassroom');
          location.href='/education.html';
        }
      }
    });

    focusLayer=document.createElement('div');
    focusLayer.dataset.classroomUi='1';
    focusLayer.setAttribute('data-html2canvas-ignore','true');
    focusLayer.style.cssText='display:none;position:fixed;inset:0;z-index:2147483601;background:rgba(8,10,18,.96);color:#fff;align-items:center;justify-content:center;text-align:center;padding:24px;font:700 clamp(24px,5vw,48px)/1.35 system-ui,sans-serif';
    document.body.appendChild(focusLayer);
  }

  // 클래스툴 방식: WebRTC getDisplayMedia로 탭 비디오 스트림 직접 캡처 (백그라운드 탭이어도 100% 완벽 동작)
  async function startMediaShare(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){
      alert('이 브라우저는 탭 직접 공유를 지원하지 않아 기본 캡처 모드로 동작합니다.');
      return;
    }
    try{
      mediaStream=await navigator.mediaDevices.getDisplayMedia({
        video:{cursor:'always',displaySurface:'browser'},
        audio:false
      });
      streamVideo=document.createElement('video');
      streamVideo.autoplay=true;
      streamVideo.muted=true;
      streamVideo.playsInline=true;
      streamVideo.srcObject=mediaStream;
      await streamVideo.play();

      const btn=bar.querySelector('button[data-share="1"]');
      if(btn){
        btn.textContent='🎥 탭 공유 중(고화질)';
        btn.style.background='#30d158';
        btn.style.color='#052e16';
      }
      mediaStream.getVideoTracks()[0].addEventListener('ended',()=>{
        streamVideo=null;
        mediaStream=null;
        if(btn){
          btn.textContent='🎥 탭 직접 공유';
          btn.style.background='#0a84ff';
          btn.style.color='#fff';
        }
      });
      // 공유 시작 즉시 1회 전송
      send(true);
    }catch(err){
      console.warn('[수업 모니터링] 탭 공유 취소 또는 오류:',err);
    }
  }

  function currentPage(){
    const parts=location.pathname.split('/').filter(Boolean);
    const title=document.title||'';
    const sub=parts.slice(-2).join('/')||location.pathname||'홈페이지';
    return (title?title+' ('+sub+')':sub).slice(0,100);
  }

  // 폴백용 미니어처 SVG 렌더러 (html2canvas 로딩 실패 또는 taint 보안 에러 시 사용)
  function generateFallbackPreview(){
    const title=escapeXml(document.title||'수업 페이지');
    const path=escapeXml(location.pathname);
    const scrollPercent=Math.round((window.scrollY/(Math.max(1,document.body.scrollHeight-window.innerHeight)))*100)||0;
    const isDocActive=document.hasFocus()?'수업 참여 중':'다른 창 보는 중';
    const activeColor=document.hasFocus()?'#30d158':'#ff9f0a';
    
    // 페이지 내 주요 텍스트 2~3줄 추출
    const headings=Array.from(document.querySelectorAll('h1, h2, h3, .tag, b'))
      .map(el=>(el.textContent||'').trim())
      .filter(t=>t.length>1&&t.length<40)
      .slice(0,3);
    const summaryLines=headings.map((h,i)=>`<text x="24" y="${120+i*28}" fill="#94a3b8" font-size="14" font-family="system-ui">· ${escapeXml(h)}</text>`).join('');

    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="450" height="270" viewBox="0 0 450 270">
      <rect width="450" height="270" fill="#0f172a"/>
      <rect x="12" y="12" width="426" height="42" rx="8" fill="#1e293b"/>
      <circle cx="32" cy="33" r="6" fill="${activeColor}"/>
      <text x="46" y="38" fill="#f8fafc" font-size="15" font-weight="bold" font-family="system-ui">${title}</text>
      <text x="360" y="37" fill="#64748b" font-size="12" font-family="system-ui">${isDocActive}</text>
      <rect x="12" y="64" width="426" height="194" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>
      <text x="24" y="92" fill="#38bdf8" font-size="13" font-family="system-ui">📄 주소: ${path}</text>
      ${summaryLines}
      <rect x="24" y="224" width="402" height="6" rx="3" fill="#334155"/>
      <rect x="24" y="224" width="${Math.max(10,Math.round(402*(scrollPercent/100)))}" height="6" rx="3" fill="#38bdf8"/>
      <text x="24" y="246" fill="#64748b" font-size="11" font-family="system-ui">스크롤 위치: ${scrollPercent}% · 실시간 활동 중</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  }

  function escapeXml(unsafe){
    return String(unsafe||'').replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c]));
  }

  async function capture(){
    if(paused||canvasBusy)return lastScreenshot||null;
    canvasBusy=true;

    // 1순위: WebRTC 비디오 스트림이 켜져 있는 경우 (0.001초 고속 캡처)
    if(streamVideo&&streamVideo.videoWidth>0){
      try{
        const w=streamVideo.videoWidth,h=streamVideo.videoHeight;
        const ratio=Math.min(1,450/w,280/h);
        const out=document.createElement('canvas');
        out.width=Math.max(1,Math.round(w*ratio));
        out.height=Math.max(1,Math.round(h*ratio));
        const ctx=out.getContext('2d');
        ctx.drawImage(streamVideo,0,0,out.width,out.height);
        const res=out.toDataURL('image/jpeg',0.55);
        lastScreenshot=res;
        return res;
      }catch(e){
        console.warn('[수업 모니터링] 비디오 캡처 오류:',e);
      }finally{
        canvasBusy=false;
      }
    }

    // 2순위: html2canvas DOM 렌더링
    try{
      if(!window.html2canvas){
        await loadCaptureLib();
      }
      if(!window.html2canvas){
        throw Error('html2canvas 라이브러리가 로드되지 않았습니다.');
      }

      const c=await window.html2canvas(document.documentElement,{
        backgroundColor:'#ffffff',
        scale:Math.min(0.35,420/Math.max(1,window.innerWidth)),
        width:window.innerWidth,
        height:window.innerHeight,
        windowWidth:window.innerWidth,
        windowHeight:window.innerHeight,
        scrollX:0,
        scrollY:window.scrollY,
        useCORS:true,
        allowTaint:true,
        logging:false,
        ignoreElements:e=>!!(e&&e.dataset&&e.dataset.classroomUi)
      });

      const ratio=Math.min(1,420/c.width,270/c.height);
      const out=document.createElement('canvas');
      out.width=Math.max(1,Math.round(c.width*ratio));
      out.height=Math.max(1,Math.round(c.height*ratio));
      const ctx=out.getContext('2d');
      ctx.drawImage(c,0,0,out.width,out.height);
      const res=out.toDataURL('image/jpeg',0.5);
      lastScreenshot=res;
      return res;
    }catch(err){
      // file:/// 또는 CORS 제약 등으로 toDataURL이 실패할 경우 미니어처 벡터 프리뷰로 자동 대체
      const fallback=generateFallbackPreview();
      lastScreenshot=fallback;
      return fallback;
    }finally{
      canvasBusy=false;
    }
  }

  function postMockMessage(msgObj){
    if(mockChannel){
      try{mockChannel.postMessage(msgObj);}catch(_){}
    }
    try{
      localStorage.setItem('classroom_mock_bus',JSON.stringify({room:cfg.room,data:msgObj,time:Date.now()}));
    }catch(_){}
  }

  async function send(withImage){
    if(stopped)return;
    let image=null;
    if(withImage&&!paused){
      image=await capture();
    }
    const finalScreenshot=paused?'':(image||lastScreenshot||'');

    if(isMock){
      postMockMessage({
        type:'student_update',
        studentId:cfg.studentId,
        studentNo:cfg.no,
        studentName:cfg.name,
        page:currentPage(),
        active:document.hasFocus(),
        sharing:!paused,
        screenshot:finalScreenshot,
        lastSeen:Date.now()
      });
      return;
    }

    try{
      await rpc('classroom_student_update',{
        p_student:cfg.studentId,
        p_token:cfg.token,
        p_page:currentPage(),
        p_active:document.hasFocus(),
        p_sharing:!paused,
        p_screenshot:finalScreenshot
      });
    }catch(e){
      console.warn('[수업 모니터링] 상태 전송 실패:',e);
    }
  }

  function loadCaptureLib(){
    if(window.html2canvas)return Promise.resolve();
    if(!html2canvasPromise){
      html2canvasPromise=new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        s.onload=()=>{resolve()};
        s.onerror=()=>{reject(Error('html2canvas 로드 실패'))};
        document.head.appendChild(s);
      });
    }
    return html2canvasPromise;
  }

  function safeNavigate(raw){
    try{
      const u=new URL(raw,location.href);
      if(u.origin!==location.origin)return;
      if(isMock)u.searchParams.set('mock','1');
      location.href=u.href;
    }catch(_){}
  }

  function showMessage(text){
    let x=document.getElementById('classroomMessage');
    if(!x){
      x=document.createElement('div');
      x.id='classroomMessage';
      x.dataset.classroomUi='1';
      x.setAttribute('data-html2canvas-ignore','true');
      x.style.cssText='position:fixed;z-index:2147483602;top:18px;left:50%;transform:translateX(-50%);max-width:90vw;padding:14px 22px;border-radius:14px;background:#ffffff;color:#111111;font:700 17px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px #0007;text-align:center;border:2px solid #64d2ff';
      document.body.appendChild(x);
    }
    x.textContent=text;
    x.style.display='block';
    clearTimeout(x._timer);
    x._timer=setTimeout(()=>x.style.display='none',5500);
  }

  function applyCommand(kind,payload){
    const p=payload||{};
    if(kind==='notice')showMessage(String(p.text||'선생님 안내를 확인해 주세요.'));
    if(kind==='focus'){
      focusLayer.style.display='flex';
      focusLayer.textContent=String(p.text||'선생님 말씀을 들어요.');
    }
    if(kind==='resume')focusLayer.style.display='none';
    if(kind==='navigate')safeNavigate(p.url);
    if(kind==='remove'){
      stopped=true;
      try{sessionStorage.setItem('cls_kicked','1')}catch(_){}
      localStorage.removeItem('homeClassroom');
      dropped('kicked');
    }
    if(kind==='end'){
      stopped=true;
      localStorage.removeItem('homeClassroom');
      dropped('ended');
    }
  }

  async function pollCommands(){
    if(isMock||busy||stopped)return;
    busy=true;
    try{
      const d=await rpc('classroom_student_commands',{
        p_student:cfg.studentId,
        p_token:cfg.token,
        p_after:cursor
      });
      if(d.removed){
        stopped=true;
        localStorage.removeItem('homeClassroom');
        if(d.kicked){                       // 선생님이 내보낸 경우: 이 탭에서는 다시 들어가지 않는다
          try{sessionStorage.setItem('cls_kicked','1')}catch(_){}
          dropped('kicked');
        }else{                              // 수업이 새로 시작되어 이전 입장이 닫힌 경우: 다시 자동 입장
          dropped('new');
        }
        return;
      }
      for(const c of d.commands||[]){
        cursor=Math.max(cursor,Number(c.id)||0);
        localStorage.setItem(cursorKey,String(cursor));
        applyCommand(c.kind,c.payload);
      }
      if(d.ended){
        stopped=true;
        localStorage.removeItem('homeClassroom');
        dropped('ended');   // 선생님이 수업을 다시 열면 이 화면에서도 다시 자동 입장한다
      }
    }catch(_){}
    finally{
      busy=false;
    }
  }

  /* 새 버전 안내: 탭을 오래 켜 두면 옛 화면 파일로 돌아 새 기능(그림 등)이 안 뜰 수 있다.
     이 파일과 활동 모듈의 ETag/Last-Modified 를 5분마다 확인해, 바뀌었으면 학생이 직접 누를 수 있는 새로고침 안내를 띄운다(수업 중 갑자기 새로고침하지 않음). */
  let versionWatching=false;
  function watchVersion(){
    if(versionWatching||!SELF)return;
    versionWatching=true;
    const urls=[SELF.split('?')[0],new URL('activity/student-activity.js',SELF).href];
    const sig=async u=>{try{const r=await fetch(u,{method:'HEAD',cache:'no-store'});return r.ok?(r.headers.get('etag')||r.headers.get('last-modified')||''):''}catch(_){return ''}};
    let base=null,told=false;
    const check=async()=>{
      if(told||document.hidden)return;
      const now=await Promise.all(urls.map(sig));
      if(!base){base=now;return}
      if(now.some((x,i)=>x&&base[i]&&x!==base[i])){
        told=true;
        showNotice('새 기능이 들어왔어요. 새로고침하면 쓸 수 있어요.','새로고침',()=>location.reload());
      }
    };
    setTimeout(check,window.__versionFirstMs||4000);
    setInterval(check,window.__versionEveryMs||300000);
  }
  async function begin(){
    makeUi();
    loadCaptureLib().catch(()=>{});

    if(isMock){
      try{
        mockChannel=new BroadcastChannel('classroom-mock-'+cfg.room);
        mockChannel.onmessage=(e)=>{
          const d=e.data;
          if(!d)return;
          if(d.type==='admin_command'){
            if(d.student&&d.student!==cfg.studentId)return;
            applyCommand(d.kind,d.payload);
          }
        };
      }catch(_){}

      window.addEventListener('storage',e=>{
        if(e.key==='classroom_mock_bus'&&e.newValue){
          try{
            const payload=JSON.parse(e.newValue);
            if(payload&&payload.room===cfg.room&&payload.data){
              const d=payload.data;
              if(d&&d.type==='admin_command'){
                if(d.student&&d.student!==cfg.studentId)return;
                applyCommand(d.kind,d.payload);
              }
            }
          }catch(_){}
        }
      });

      postMockMessage({
        type:'student_join',
        studentId:cfg.studentId,
        studentNo:cfg.no,
        studentName:cfg.name,
        time:Date.now()
      });
    }

    // 첫 입장 시 즉시 1회 캡처 전송
    await send(true);
    setInterval(()=>send(true),3000);
    if(!isMock)setInterval(pollCommands,1700);

    window.addEventListener('focus',()=>send(true));
    window.addEventListener('blur',()=>send(false));
    window.addEventListener('beforeunload',()=>{
      if(isMock){
        postMockMessage({type:'student_leave',studentId:cfg.studentId});
      }
    });

    if(!isMock)pollCommands();

    // 수업 활동 모듈(주관식·객관식·영상): 선생님이 낸 활동을 지금 보는 페이지 위에 띄운다. 실패해도 수업 화면 공유에는 영향이 없다.
    if(!isMock&&SELF){
      try{
        const s=document.createElement('script');
        s.src=new URL('activity/student-activity.js',SELF).href;
        s.onload=()=>{try{window.ClassroomActivityStudent.start({rpc,studentId:cfg.studentId,token:cfg.token})}catch(_){}};
        document.head.appendChild(s);
      }catch(_){}
      watchVersion();
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',begin,{once:true});
  }else{
    begin();
  }
  }
  main();
  const tryJoin=async()=>{
    if(booted||document.hidden)return;
    if(readCfg()){main();if(booted)clearInterval(retryTimer);return}
    if(await autoJoin()){main();if(booted)clearInterval(retryTimer)}
  };
  // 수업이 끝나거나 새로 시작되어 입장이 닫히면: 화면 표시를 걷고 30초마다 다시 입장을 확인한다(수업을 다시 열면 자동 입장)
  const MSG={
    ended:'수업이 끝났어요. 지금은 수업에 연결되어 있지 않아요.',
    'new':'수업이 새로 시작되어 연결이 끊겼어요. 잠시 뒤 자동으로 다시 들어가요.',
    kicked:'선생님이 수업에서 내보냈어요. 선생님께 말씀드려요.'
  };
  function rejoin(){
    try{sessionStorage.removeItem('cls_kicked')}catch(_){}
    clearInterval(retryTimer);retryTimer=setInterval(tryJoin,30000);
    tryJoin().then(()=>{if(!booted)showChip('⚪ 지금은 수업이 열려 있지 않아요',null)});
  }
  dropHook=(reason)=>{
    booted=false;
    try{document.querySelectorAll('[data-classroom-ui="1"][data-html2canvas-ignore]:not([data-keep-ui])').forEach(n=>{if(n.id!=='classroomMessage')n.remove()})}catch(_){}
    clearInterval(retryTimer);
    if(reason==='kicked'){
      showChip('⛔ 수업에서 나갔어요 (눌러서 다시 들어가기)',rejoin);
      showNotice(MSG.kicked,'다시 들어가기',rejoin);
    }else{
      showChip(reason==='new'?'⚪ 수업 다시 연결 중…':'⚪ 수업 연결 안 됨 (수업이 끝났어요)',null);
      showNotice(MSG[reason]||MSG.ended);
      if(readLogin())retryTimer=setInterval(tryJoin,30000);
    }
  };
  // 처음부터 연결이 안 된 화면도 "연결 안 됨"을 보여 준다(내보내진 탭이면 눌러서 다시 들어가기)
  setTimeout(()=>{
    if(booted||!readLogin()||/\/school-tool\/|\/classroom\/teacher\.html/.test(location.pathname))return;
    let kicked=false;try{kicked=!!sessionStorage.getItem('cls_kicked')}catch(_){}
    showChip(kicked?'⛔ 수업에서 나갔어요 (눌러서 다시 들어가기)':'⚪ 수업 연결 안 됨',kicked?rejoin:null);
  },9000);
  if(!booted&&readLogin()){setTimeout(tryJoin,1500+Math.random()*3000);retryTimer=setInterval(tryJoin,30000)}
})();
