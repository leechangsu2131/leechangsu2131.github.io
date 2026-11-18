/* 수업 활동 모듈 — 학생 쪽.
   선생님이 낸 활동(주관식·객관식·영상 보기)을 지금 보고 있는 페이지 위에 카드로 띄우고, 답을 낸다.
   - classroom/monitor.js 가 수업방 입장 뒤에 이 파일을 불러 start() 한다(모의실험 모드에서는 부르지 않음).
   - 서버와는 cra_student_current / cra_student_submit 두 함수로만 이야기한다(classroom/activity/schema.sql).
   - 학생 글·선생님 글은 모두 textContent 로만 화면에 넣는다(HTML 로 해석하지 않음).
   - 학생이 '작게' 눌러 접어 두면 오른쪽 아래 작은 버튼만 남는다. 접은 상태는 이 탭에서 활동마다 기억한다. */
(()=>{
  'use strict';
  if(window.ClassroomActivityStudent)return;

  const POLL_MS=2500, POLL_HIDDEN_MS=8000;
  const Z=2147483590;   // monitor.js 의 주의집중 덮개(…601)·안내(…602)보다 아래
  const MARK=['①','②','③','④','⑤','⑥'];

  function ss(k,v){
    try{ if(v===undefined)return sessionStorage.getItem(k); if(v===null)sessionStorage.removeItem(k); else sessionStorage.setItem(k,v); }catch(_){}
    return null;
  }
  function el(tag,css,text){
    const e=document.createElement(tag);
    if(css)e.style.cssText=css;
    if(text!=null)e.textContent=text;
    return e;
  }
  function youtubeId(url){
    try{
      const u=new URL(url);
      if(u.protocol!=='https:')return null;
      let id=null;
      if(u.hostname==='youtu.be')id=u.pathname.slice(1);
      else if(/(^|\.)youtube\.com$/.test(u.hostname)){
        if(u.pathname==='/watch')id=u.searchParams.get('v');
        else{const m=u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/);if(m)id=m[2];}
      }
      return id&&/^[\w-]{11}$/.test(id)?id:null;
    }catch(_){return null}
  }
  function safeHttps(url){
    try{const u=new URL(url);return u.protocol==='https:'?u.href:null}catch(_){return null}
  }

  let current=null;   // 한 화면에는 활동 모듈이 하나만: 다시 입장하면 이전 것을 끄고 새로 시작한다
  function start(opt){
    if(current){try{current.stop()}catch(_){}current=null}
    const rpc=opt.rpc, sid=opt.studentId, tok=opt.token;
    let stopped=false, busy=false, timer=0;
    let shownSig='', last=null, root=null, mini=null, card=null, ui={}, clock=null;
    function tickClock(){
      if(!clock||!ui.tm)return;
      const left=Math.ceil((clock.end-(Date.now()+clock.off))/1000);
      if(left<=0&&ui.autoSend&&!ui.autoSent){ui.autoSent=true;ui.autoSend()}
      ui.tm.textContent=left>0?'⏱ 남은 시간 '+(left>=60?Math.floor(left/60)+'분 '+(left%60)+'초':left+'초'):'⏱ 시간이 다 됐어요';
    }
    const clockTimer=setInterval(tickClock,500);

    const BTN='border:0;border-radius:14px;padding:12px 18px;font:700 20px/1.2 system-ui,"Apple SD Gothic Neo",sans-serif;cursor:pointer;touch-action:manipulation';

    function ensureRoot(){
      if(root)return;
      root=el('div','display:none;position:fixed;inset:0;z-index:'+Z+';background:rgba(15,23,42,.38);align-items:center;justify-content:center;padding:12px;overflow:auto;font-family:system-ui,"Apple SD Gothic Neo",sans-serif');
      root.dataset.classroomUi='1';root.id='craStudent';
      document.body.appendChild(root);
      mini=el('button','display:none;position:fixed;right:12px;bottom:12px;z-index:'+Z+';'+BTN+';background:#2563eb;color:#fff;box-shadow:0 6px 20px #0006','📝 활동 열기');
      mini.dataset.classroomUi='1';
      mini.type='button';
      mini.onclick=()=>{ss('cra_min:'+(last&&last.activity?last.activity.id:''),null);render(last,true)};
      document.body.appendChild(mini);
    }
    function hideAll(){
      if(root){root.style.display='none';root.replaceChildren();}
      if(mini)mini.style.display='none';
      shownSig='';card=null;ui={};
    }

    function label(kind){
      return kind==='text'?'✍️ 글로 답해요':kind==='choice'?'✅ 하나를 골라요':kind==='draw'?'🎨 그림으로 그려요':kind==='photo'?'📷 사진으로 내요':'▶️ 같이 봐요';
    }

    function build(d){
      const a=d.activity;
      root.replaceChildren();ui={};
      card=el('div','background:#fff;color:#111827;border-radius:22px;width:min(680px,100%);max-height:100%;overflow:auto;padding:20px 20px 22px;box-shadow:0 18px 60px #0008');
      const head=el('div','display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px');
      head.appendChild(el('div','font:800 18px/1.3 system-ui;color:#2563eb',label(a.kind)));
      const hb=el('div','display:flex;gap:8px');
      const minBtn=el('button','border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;border-radius:12px;padding:8px 14px;font:700 16px system-ui;cursor:pointer','작게');
      minBtn.type='button';
      minBtn.onclick=()=>{ss('cra_min:'+a.id,'1');render(last,true)};
      hb.appendChild(minBtn);
      if(a.kind==='video'||(a.status==='closed')){
        const x=el('button','border:1px solid #cbd5e1;background:#f1f5f9;color:#334155;border-radius:12px;padding:8px 14px;font:700 16px system-ui;cursor:pointer','닫기');
        x.type='button';
        x.onclick=()=>{ss('cra_dismiss:'+a.id,'1');render(last,true)};
        hb.appendChild(x);
      }
      head.appendChild(hb);
      card.appendChild(head);
      // 시간 제한: 서버 시각 기준으로 남은 시간을 센다(기기 시계가 달라도 같게)
      clock=null;
      const secs=a.config&&Number(a.config.seconds);
      if(a.status==='open'&&secs>=10&&secs<=3600&&a.created_at&&d.now){
        const off=Date.parse(d.now)-Date.now(), end=Date.parse(a.created_at)+secs*1000;
        if(!isNaN(off)&&!isNaN(end)){
          clock={end,off};
          ui.tm=el('div','font:800 22px/1.3 system-ui;color:#b45309;margin:0 0 6px');
          card.appendChild(ui.tm);tickClock();
        }
      }
      card.appendChild(el('div','font:800 clamp(22px,4.6vw,30px)/1.45 system-ui,"Apple SD Gothic Neo",sans-serif;margin:6px 0 16px;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere',a.title));

      ui.note=el('div','margin-top:12px;font:700 18px/1.5 system-ui;color:#475569;min-height:26px');
      if(a.kind==='text')buildText(a,d);
      else if(a.kind==='choice')buildChoice(a,d);
      else if((a.kind==='draw'||a.kind==='photo')&&a.reveal)buildGallery(a);
      else if(a.kind==='draw')buildDraw(a,d);
      else if(a.kind==='photo')buildPhoto(a,d);
      else buildVideo(a);
      card.appendChild(ui.note);
      root.appendChild(card);
    }

    function setNote(text,color){
      if(!ui.note)return;
      ui.note.textContent=text||'';
      ui.note.style.color=color||'#475569';
    }

    function buildText(a,d){
      const closed=a.status==='closed';
      ui.ta=el('textarea','width:100%;min-height:150px;font:600 22px/1.6 system-ui,"Apple SD Gothic Neo",sans-serif;padding:14px;border:3px solid #94a3b8;border-radius:16px;resize:vertical;color:#111827;background:#fff');
      ui.ta.maxLength=1000;
      ui.ta.placeholder='여기에 적어요';
      ui.ta.disabled=closed;
      if(d.my&&typeof d.my.text==='string')ui.ta.value=d.my.text;
      card.appendChild(ui.ta);
      if(!closed){
        ui.send=el('button',BTN+';margin-top:12px;background:#16a34a;color:#fff;width:100%',d.my?'고쳐서 다시 보내기':'선생님께 보내기');
        ui.send.type='button';
        ui.send.onclick=async()=>{
          const t=ui.ta.value.trim();
          if(!t){setNote('먼저 글을 적어 주세요.','#b45309');return}
          ui.send.disabled=true;setNote('보내는 중…');
          try{
            await rpc('cra_student_submit',{p_student:sid,p_token:tok,p_activity:a.id,p_answer:{text:t}});
            ui.send.textContent='고쳐서 다시 보내기';
            setNote('✔ 보냈어요! 마감 전까지는 고쳐서 다시 보낼 수 있어요.','#15803d');
          }catch(e){
            setNote(/closed/.test(String(e.message))?'앗, 마감되었어요.':'보내지 못했어요. 잠시 뒤에 다시 눌러 보세요.','#b91c1c');
            poll();
          }
          ui.send.disabled=false;
        };
        card.appendChild(ui.send);
        if(d.my)setNote('✔ 보낸 답이 있어요. 고쳐서 다시 보낼 수 있어요.','#15803d');
      }else{
        setNote(d.my?'마감되었어요. 내가 보낸 답이에요.':'마감되었어요.');
      }
    }

    function buildDraw(a,d){
      const closed=a.status==='closed';
      const W=800,H=600;
      const cv=el('canvas','width:100%;aspect-ratio:4/3;display:block;background:#fff;border:3px solid #94a3b8;border-radius:14px;touch-action:none;cursor:crosshair');
      cv.width=W;cv.height=H;
      const g=cv.getContext('2d');
      g.fillStyle='#fff';g.fillRect(0,0,W,H);g.lineCap='round';g.lineJoin='round';
      ui.cv=cv;
      let color='#111827',size=6,erase=false,drew=false,sentSig='',last2=null;
      const undo=[];
      function snap(){try{undo.push(g.getImageData(0,0,W,H));if(undo.length>12)undo.shift()}catch(_){}}
      function pos(e){const r=cv.getBoundingClientRect();return [(e.clientX-r.left)*W/r.width,(e.clientY-r.top)*H/r.height]}
      if(!closed){
        cv.addEventListener('pointerdown',e=>{
          e.preventDefault();try{cv.setPointerCapture(e.pointerId)}catch(_){}
          snap();last2=pos(e);drew=true;
          g.strokeStyle=erase?'#ffffff':color;g.lineWidth=erase?size*3:size;
          g.beginPath();g.moveTo(last2[0],last2[1]);g.lineTo(last2[0]+0.01,last2[1]+0.01);g.stroke();
        });
        cv.addEventListener('pointermove',e=>{
          if(!last2)return;e.preventDefault();
          const p=pos(e);g.beginPath();g.moveTo(last2[0],last2[1]);g.lineTo(p[0],p[1]);g.stroke();last2=p;
        });
        const end=e=>{last2=null};
        cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);cv.addEventListener('pointerleave',end);
      }
      card.appendChild(cv);
      if(!closed){
        const bar=el('div','display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px');
        const sw=[];
        function mark(){sw.forEach(([b,c])=>{b.style.outline=(!erase&&c===color)?'4px solid #2563eb':'none'});eb.style.outline=erase?'4px solid #2563eb':'none';sz.forEach(([b,n])=>{b.style.background=n===size?'#dbeafe':'#f1f5f9'})}
        ['#111827','#e11d48','#2563eb','#16a34a','#f59e0b','#92400e'].forEach(c=>{
          const b=el('button','width:40px;height:40px;border-radius:50%;border:2px solid #cbd5e1;cursor:pointer;touch-action:manipulation;background:'+c);
          b.type='button';b.setAttribute('aria-label','색 '+c);b.onclick=()=>{color=c;erase=false;mark()};sw.push([b,c]);bar.appendChild(b);
        });
        const eb=el('button','border:2px solid #cbd5e1;background:#f1f5f9;color:#111827;border-radius:12px;padding:8px 12px;font:700 16px system-ui;cursor:pointer;touch-action:manipulation','🧽 지우개');
        eb.type='button';eb.onclick=()=>{erase=true;mark()};bar.appendChild(eb);
        const sz=[];
        [['가늘게',3],['보통',6],['굵게',14]].forEach(([t,n])=>{
          const b=el('button','border:2px solid #cbd5e1;color:#111827;border-radius:12px;padding:8px 12px;font:700 16px system-ui;cursor:pointer;touch-action:manipulation',t);
          b.type='button';b.onclick=()=>{size=n;mark()};sz.push([b,n]);bar.appendChild(b);
        });
        const ub=el('button','border:2px solid #cbd5e1;background:#f1f5f9;color:#111827;border-radius:12px;padding:8px 12px;font:700 16px system-ui;cursor:pointer;touch-action:manipulation','↩ 되돌리기');
        ub.type='button';ub.onclick=()=>{const x=undo.pop();if(x)g.putImageData(x,0,0)};bar.appendChild(ub);
        const cb=el('button','border:2px solid #cbd5e1;background:#f1f5f9;color:#111827;border-radius:12px;padding:8px 12px;font:700 16px system-ui;cursor:pointer;touch-action:manipulation','🗑 모두 지우기');
        cb.type='button';cb.onclick=()=>{snap();g.fillStyle='#fff';g.fillRect(0,0,W,H);drew=false};bar.appendChild(cb);
        card.appendChild(bar);mark();
        function pack(){
          for(const q of [0.8,0.65,0.5,0.35]){
            const u=cv.toDataURL('image/jpeg',q);
            if(u.length<=330000)return u;
          }
          return null;
        }
        async function send(auto){
          if(!drew){if(!auto)setNote('먼저 그림을 그려 주세요.','#b45309');return}
          const u=pack();
          if(!u){setNote('그림이 너무 커요. 지우고 다시 그려 주세요.','#b91c1c');return}
          if(u===sentSig)return;
          ui.send.disabled=true;setNote(auto?'시간이 다 되어 자동으로 보내는 중…':'보내는 중…');
          try{
            await rpc('cra_student_submit',{p_student:sid,p_token:tok,p_activity:a.id,p_answer:{img:u}});
            sentSig=u;
            ui.send.textContent='고쳐서 다시 보내기';
            setNote('✔ 보냈어요! 마감 전까지는 고쳐 그려서 다시 보낼 수 있어요.','#15803d');
          }catch(e){
            setNote(/closed/.test(String(e.message))?'앗, 마감되었어요.':'보내지 못했어요. 잠시 뒤에 다시 눌러 보세요.','#b91c1c');
          }
          ui.send.disabled=false;
        }
        ui.send=el('button',BTN+';margin-top:12px;background:#16a34a;color:#fff;width:100%',d.my?'새로 그려서 다시 보내기':'선생님께 보내기');
        ui.send.type='button';ui.send.onclick=()=>send(false);
        card.appendChild(ui.send);
        ui.autoSend=()=>send(true);
        if(d.my)setNote('✔ 보낸 그림이 있어요. 새로 그려서 보내면 바뀌어요.','#15803d');
      }else{
        setNote(d.my?'마감되었어요. 그림을 보냈어요.':'마감되었어요.');
      }
    }

    // 사진: 찍거나 고른 사진을 브라우저에서 줄여(긴 쪽 1280px JPEG) 보낸다. 다시 그리는 과정에서 위치(GPS) 등 사진 속 정보는 모두 사라진다.
    function buildPhoto(a,d){
      const closed=a.status==='closed';
      if(closed){setNote(d.my?'마감되었어요. 사진을 보냈어요.':'마감되었어요.');return}
      const warn=el('div','background:#fef3c7;border:2px solid #f59e0b;border-radius:14px;padding:12px 14px;font:700 18px/1.5 system-ui;color:#78350f;margin-bottom:10px','⚠️ 얼굴, 이름표, 집 주소가 나오지 않게 찍어요. 내 작품이나 물건만 찍어요.');
      card.appendChild(warn);
      let jpeg='',sentSig='';
      const prev=el('canvas','width:100%;max-height:50vh;object-fit:contain;display:none;background:#e2e8f0;border-radius:12px;margin-top:10px');
      ui.cv=prev;
      const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.setAttribute('capture','environment');inp.style.display='none';
      const pick=el('button',BTN+';background:#2563eb;color:#fff;width:100%','📷 사진 찍기 / 고르기');pick.type='button';pick.onclick=()=>inp.click();
      card.append(pick,inp,prev);
      const lab=el('label','display:flex;gap:10px;align-items:center;margin-top:12px;font:700 19px/1.4 system-ui;color:#0f172a;cursor:pointer');
      const ck=document.createElement('input');ck.type='checkbox';ck.style.cssText='width:26px;height:26px;flex:none';
      lab.append(ck,el('span','','얼굴과 이름이 나오지 않았어요.'));
      card.appendChild(lab);
      ui.send=el('button',BTN+';margin-top:12px;background:#16a34a;color:#fff;width:100%',d.my?'새 사진으로 다시 보내기':'선생님께 보내기');ui.send.type='button';
      card.appendChild(ui.send);
      async function load(file){
        if(!file)return;
        try{
          if(!/^image\//.test(file.type))throw new Error('type');
          const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
          const sc=Math.min(1,1280/Math.max(bmp.width,bmp.height));
          const w=Math.max(1,Math.round(bmp.width*sc)),h=Math.max(1,Math.round(bmp.height*sc));
          prev.width=w;prev.height=h;
          const g=prev.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);g.drawImage(bmp,0,0,w,h);
          if(bmp.close)bmp.close();
          jpeg='';
          for(const q of [0.75,0.6,0.45,0.3]){const u=prev.toDataURL('image/jpeg',q);if(u.length<=330000){jpeg=u;break}}
          if(!jpeg)throw new Error('big');
          prev.style.display='block';setNote('사진을 골랐어요. 아래 확인에 체크하고 보내요.');
        }catch(_){jpeg='';prev.style.display='none';setNote('이 사진은 쓸 수 없어요. 다른 사진을 골라 주세요.','#b91c1c')}
      }
      inp.onchange=()=>load(inp.files&&inp.files[0]);
      async function send(auto){
        if(!jpeg){if(!auto)setNote('먼저 사진을 찍거나 골라 주세요.','#b45309');return}
        if(!ck.checked){if(!auto)setNote('얼굴과 이름이 나오지 않았는지 확인하고 체크해 주세요.','#b45309');return}
        if(jpeg===sentSig)return;
        ui.send.disabled=true;setNote(auto?'시간이 다 되어 자동으로 보내는 중…':'보내는 중…');
        try{
          await rpc('cra_student_submit',{p_student:sid,p_token:tok,p_activity:a.id,p_answer:{img:jpeg}});
          sentSig=jpeg;ui.send.textContent='새 사진으로 다시 보내기';
          setNote('✔ 보냈어요! 마감 전까지는 다른 사진으로 바꿔 보낼 수 있어요.','#15803d');
        }catch(e){setNote(/closed/.test(String(e.message))?'앗, 마감되었어요.':'보내지 못했어요. 잠시 뒤에 다시 눌러 보세요.','#b91c1c')}
        ui.send.disabled=false;
      }
      ui.send.onclick=()=>send(false);
      ui.autoSend=()=>send(true);
      if(d.my)setNote('✔ 보낸 사진이 있어요. 새 사진으로 보내면 바뀌어요.','#15803d');
    }

    function buildChoice(a,d){
      const choices=(a.config&&a.config.choices)||[];
      const closed=a.status==='closed';
      const ans=a.reveal&&a.config&&typeof a.config.answer==='number'?a.config.answer:null;
      const counts=d.counts||{};
      const total=Object.values(counts).reduce((s,n)=>s+Number(n||0),0);
      const mine=d.my&&typeof d.my.choice==='number'?d.my.choice:null;
      ui.btns=[];
      const list=el('div','display:grid;gap:12px');
      choices.forEach((c,i)=>{
        const b=el('button','position:relative;text-align:left;overflow:hidden;border:4px solid #94a3b8;background:#fff;color:#111827;border-radius:18px;padding:16px 16px;font:700 clamp(20px,4.2vw,26px)/1.4 system-ui,"Apple SD Gothic Neo",sans-serif;cursor:pointer;touch-action:manipulation;word-break:keep-all;overflow-wrap:anywhere');
        b.type='button';
        if(a.reveal&&total>0){
          const pct=Math.round(100*Number(counts[i]||0)/total);
          const bar=el('div','position:absolute;left:0;top:0;bottom:0;width:'+pct+'%;background:'+(ans===i?'#bbf7d0':'#e2e8f0')+';z-index:0');
          b.appendChild(bar);
        }
        const t=el('div','position:relative;z-index:1;display:flex;gap:10px;align-items:center;justify-content:space-between');
        t.appendChild(el('span','',(MARK[i]||(i+1))+' '+String(c)));
        if(a.reveal&&total>0)t.appendChild(el('span','font-size:18px;color:#475569;white-space:nowrap',(counts[i]||0)+'명'));
        b.appendChild(t);
        paintChoice(b,i,mine,ans,closed);
        b.disabled=closed;
        b.onclick=async()=>{
          if(a.status==='closed')return;
          ui.btns.forEach((x,j)=>paintChoice(x,j,i,null,false));
          setNote('보내는 중…');
          try{
            await rpc('cra_student_submit',{p_student:sid,p_token:tok,p_activity:a.id,p_answer:{choice:i}});
            setNote('✔ '+(MARK[i]||(i+1))+' 번을 골랐어요. 마감 전까지는 다시 고를 수 있어요.','#15803d');
          }catch(e){
            setNote(/closed/.test(String(e.message))?'앗, 마감되었어요.':'보내지 못했어요. 다시 눌러 보세요.','#b91c1c');
            poll();
          }
        };
        ui.btns.push(b);
        list.appendChild(b);
      });
      card.appendChild(list);
      if(a.reveal&&ans!==null){
        if(mine===null)setNote('정답은 '+(MARK[ans]||(ans+1))+' 번이에요.','#15803d');
        else if(mine===ans)setNote('🎉 맞았어요! 정답은 '+(MARK[ans]||(ans+1))+' 번이에요.','#15803d');
        else setNote('아쉬워요. 정답은 '+(MARK[ans]||(ans+1))+' 번이에요. 다시 생각해 봐요!','#b45309');
      }else if(a.reveal){
        setNote('친구들은 이렇게 골랐어요.');
      }else if(mine!==null){
        setNote('✔ '+(MARK[mine]||(mine+1))+' 번을 골랐어요. 마감 전까지는 다시 고를 수 있어요.','#15803d');
      }else if(closed){
        setNote('마감되었어요.');
      }
    }
    function paintChoice(b,i,mine,ans,closed){
      const isMine=mine===i, isAns=ans===i;
      b.style.borderColor=isAns?'#16a34a':isMine?'#2563eb':'#94a3b8';
      b.style.background=isMine&&!isAns?'#eff6ff':'#fff';
      b.style.opacity=closed&&!isMine&&!isAns?'.85':'1';
    }

    // 교사가 '친구들에게 공개'한 그림·사진: 이름 없이 모아 보여 준다(서버가 이름·번호를 주지 않는다)
    function buildGallery(a){
      card.appendChild(el('div','font:700 18px/1.5 system-ui;color:#475569;margin-bottom:10px','친구들의 작품이에요. 누르면 크게 보여요.'));
      const grid=el('div','display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px');
      grid.textContent='불러오는 중…';
      card.appendChild(grid);
      ui.grid=grid;
      rpc('cra_student_gallery',{p_student:sid,p_token:tok,p_activity:a.id}).then(g=>{
        if(ui.grid!==grid)return;
        const items=(g&&g.items)||[];
        grid.textContent='';
        if(!items.length){grid.textContent='보여 줄 작품이 아직 없어요.';return}
        items.forEach(it=>{
          if(typeof it.img!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(it.img))return;
          const b=el('button','border:'+(it.mine?'3px solid #2563eb':'1px solid #cbd5e1')+';border-radius:12px;padding:0;background:#fff;cursor:pointer;overflow:hidden;position:relative');
          b.type='button';
          const im=document.createElement('img');im.src=it.img;im.alt='친구 작품';im.style.cssText='display:block;width:100%;height:auto';
          b.appendChild(im);
          if(it.mine)b.appendChild(el('span','position:absolute;left:6px;top:6px;background:#2563eb;color:#fff;border-radius:8px;padding:2px 8px;font:700 14px system-ui','내 것'));
          b.onclick=()=>zoom(it.img);
          grid.appendChild(b);
        });
      }).catch(()=>{if(ui.grid===grid)grid.textContent='작품을 불러오지 못했어요.'});
    }
    function zoom(src){
      const ov=el('div','position:fixed;inset:0;z-index:'+(Z+1)+';background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:10px;cursor:pointer');
      ov.dataset.classroomUi='1';
      const im=document.createElement('img');im.src=src;im.style.cssText='max-width:100%;max-height:100%;border-radius:8px;background:#fff';
      ov.appendChild(im);ov.onclick=()=>ov.remove();
      document.body.appendChild(ov);
    }

    function buildVideo(a){
      const url=a.config&&a.config.url;
      const yt=youtubeId(url);
      if(yt){
        const box=el('div','position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden');
        const f=document.createElement('iframe');
        f.src='https://www.youtube-nocookie.com/embed/'+yt+'?rel=0&playsinline=1';
        f.title='선생님이 보여 주는 영상';
        f.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
        f.allowFullscreen=true;
        f.referrerPolicy='strict-origin-when-cross-origin';
        f.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0';
        box.appendChild(f);
        card.appendChild(box);
      }
      const safe=safeHttps(url);
      if(safe){
        const a2=el('a',BTN+';display:block;margin-top:12px;text-align:center;text-decoration:none;background:#2563eb;color:#fff',yt?'새 창에서 크게 보기':'▶ 영상 열기');
        a2.href=safe;a2.target='_blank';a2.rel='noopener noreferrer';
        card.appendChild(a2);
      }else{
        card.appendChild(el('div','color:#b91c1c;font:700 18px system-ui','영상 주소를 열 수 없어요. 선생님께 알려 주세요.'));
      }
    }

    function render(d,force){
      ensureRoot();
      last=d;
      const a=d&&d.activity;
      if(!a){hideAll();return}
      // 마감된 활동은 공개된 결과만 보여 주고, 학생이 닫았으면 더 띄우지 않는다
      if(ss('cra_dismiss:'+a.id)){hideAll();return}
      if(a.status==='closed'&&!a.reveal){
        if(!ss('cra_closed:'+a.id)){ss('cra_closed:'+a.id,'1');notifyClosed()}
        hideAll();return;
      }
      if(ss('cra_min:'+a.id)){
        root.style.display='none';
        mini.style.display='block';
        shownSig='min:'+a.id;
        return;
      }
      mini.style.display='none';
      root.style.display='flex';
      const sig=[a.id,a.status,a.reveal,JSON.stringify(d.counts||null),a.reveal?JSON.stringify(a.config):'',d.my?JSON.stringify(d.my):''].join('|');
      // 입력 중인 글이 지워지지 않도록, 바뀐 것이 없으면 다시 그리지 않는다.
      // 글 상자에 글을 쓰고 있을 때는 같은 활동 안에서 내 답이 바뀌어도(다른 기기 등) 덮어쓰지 않는다.
      if(!force&&sig===shownSig)return;
      const typing=ui.ta&&document.activeElement===ui.ta&&shownSig.startsWith(a.id+'|')&&a.status==='open';
      if(typing&&!force){shownSig=sig;return}
      // 그리는 중인 그림은 서버 상태가 바뀌어도(내가 보낸 직후 등) 지워지지 않게 다시 그리지 않는다
      const drawing=ui.cv&&(a.kind==='draw'||a.kind==='photo')&&shownSig.startsWith(a.id+'|')&&a.status==='open';
      if(drawing&&!force){shownSig=sig;return}
      shownSig=sig;
      build(d);
    }

    function notifyClosed(){
      const m=el('div','position:fixed;z-index:'+Z+';top:18px;left:50%;transform:translateX(-50%);max-width:90vw;padding:14px 22px;border-radius:14px;background:#fff;color:#111;font:700 18px/1.4 system-ui;box-shadow:0 8px 30px #0007;border:2px solid #64d2ff','활동이 마감되었어요.');
      m.dataset.classroomUi='1';
      document.body.appendChild(m);
      setTimeout(()=>m.remove(),3500);
    }

    async function poll(){
      if(stopped||busy)return;
      busy=true;
      try{
        const d=await rpc('cra_student_current',{p_student:sid,p_token:tok});
        if(d&&d.removed){stopped=true;clearInterval(timer);hideAll();return}
        render(d,false);
      }catch(_){}
      finally{busy=false}
    }
    function schedule(){
      clearInterval(timer);
      timer=setInterval(poll,document.hidden?POLL_HIDDEN_MS:POLL_MS);
    }
    const onVis=()=>{if(stopped)return;schedule();if(!document.hidden)poll()};
    document.addEventListener('visibilitychange',onVis);
    setTimeout(poll,300+Math.random()*1200);   // 반 전체가 한꺼번에 몰리지 않게 조금 흩뜨린다
    schedule();
    current={stop(){stopped=true;clearInterval(timer);try{clearInterval(clockTimer)}catch(_){}document.removeEventListener('visibilitychange',onVis);hideAll()}};
    return current;
  }

  window.ClassroomActivityStudent={start,stop(){if(current){try{current.stop()}catch(_){}current=null}}};
})();
