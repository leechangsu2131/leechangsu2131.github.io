/* 학생 화면 상태 전송 및 교사 명령 수신. */
(()=>{
  'use strict';
  let cfg;
  try{
    cfg=JSON.parse(localStorage.getItem('homeClassroom')||'null');
  }catch(_){return}
  if(!cfg||!cfg.studentId)return;
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
    bar.style.cssText='position:fixed;z-index:2147483600;left:12px;bottom:12px;display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:12px;background:#14141beF;color:#fff;border:1px solid #ffffff35;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px #0007;flex-wrap:wrap';
    
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
      localStorage.removeItem('homeClassroom');
      showMessage('선생님이 수업에서 내보냈습니다.');
      setTimeout(()=>location.href='/education.html',1800);
    }
    if(kind==='end'){
      stopped=true;
      localStorage.removeItem('homeClassroom');
      showMessage('수업이 종료되었습니다.');
      setTimeout(()=>location.href='/education.html',2200);
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
        showMessage('수업에서 나왔습니다.');
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
        showMessage('수업이 종료되었습니다.');
        setTimeout(()=>location.href='/education.html',2200);
      }
    }catch(_){}
    finally{
      busy=false;
    }
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
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',begin,{once:true});
  }else{
    begin();
  }
})();