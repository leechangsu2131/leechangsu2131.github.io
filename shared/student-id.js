/* 학생 확인(게임·연습·시험 기록 페이지 공통). 학생 명단은 코드에 두지 않고 서버(game-board 함수)가 확인한다.
   1) 같은 탭에 구글 로그인(st_s)이 있으면 그 학생으로 본다(번호·이름은 로그인한 계정의 것).
   2) 로그인이 없으면 학생이 직접 쓴 번호+이름을 서버에 보내 맞는지만 확인한다(명단 목록은 받지 않는다).
      서버에서 직접 입력 확인을 끄면(ST_ALLOW_NAME_LOGIN=0) 이 길은 '미분류'로 남는다.
   서버가 안 맞다고 하거나 연결이 안 되면 '미분류'로 기록하고, 학생이 쓴 값은 내용 앞에 남긴다(기존 방식 그대로).
   사용: StudentID.resolve(번호, 이름, {allowLogin}) → {valid, matched, num, recordName, via, note, noteIfMismatch, typedName}
        StudentID.boardPost(결과, xp, 종류)    StudentID.boardList()    StudentID.prefill(번호칸, 이름칸) */
(function(){
  'use strict';
  var U='https://erzdvlcbjneabxqwnwfy.supabase.co', K='sb_publishable_29w26VjvhHwI5O6iKOXTwA_sSTKUhfz';
  var FN=U+'/functions/v1/game-board';

  function rd(){ try{ return JSON.parse(sessionStorage.getItem('st_s')||'null'); }catch(e){ return null; } }
  function nameKey(t){ return String(t==null?'':t).normalize('NFC').replace(/\s+/g,'').toLowerCase(); }
  function login(){
    var s=rd();
    if(s && s.access && s.num && s.name){ var n=parseInt(s.num,10); if(n>=1) return {num:n,name:String(s.name)}; }
    return null;
  }

  // 로그인 토큰(만료가 가까우면 새로 받아 st_s 에 되돌려 둔다. classroom/monitor.js 와 같은 방식)
  async function token(){
    var s=rd(); if(!s||!s.access) return null;
    if(Date.now()<=(s.exp||0)-60000) return s.access;
    s=rd(); if(!s||!s.access) return null;   // 갱신 직전에 다시 읽어, 다른 스크립트가 방금 갱신한 값을 덮어쓰지 않게 한다
    if(Date.now()<=(s.exp||0)-60000) return s.access;
    var r=await fetch(U+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:K,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh})});
    var j=await r.json().catch(function(){return {};});
    if(!r.ok||!j.access_token) return null;
    s=Object.assign({},s,{access:j.access_token,refresh:j.refresh_token||s.refresh,exp:Date.now()+(j.expires_in||3600)*1000});
    try{ sessionStorage.setItem('st_s',JSON.stringify(s)); }catch(e){}
    return s.access;
  }

  async function call(payload,keepalive){
    var ctl=new AbortController(), to=setTimeout(function(){ctl.abort();},12000);
    try{
      var r=await fetch(FN,{method:'POST',signal:ctl.signal,keepalive:!!keepalive,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      var j=await r.json().catch(function(){return {};});
      if(!r.ok){ var e=new Error(j.error||('HTTP '+r.status)); e.code=j.error||''; e.status=r.status; throw e; }
      return j;
    } finally { clearTimeout(to); }
  }

  function mismatchNote(numRaw,name){ return '[확인필요 · 학생 입력: 번호 '+(numRaw||'?')+' / 이름 '+(name||'?')+'] '; }

  // 번호·이름 → 학생 확인. allowLogin=false 면 로그인 정보를 쓰지 않는다(같은 기기의 두 번째 사람 등).
  async function resolve(numRaw,nameRaw,opts){
    opts=opts||{};
    var numStr=String(numRaw==null?'':numRaw).trim(), name=String(nameRaw==null?'':nameRaw).trim(), num=parseInt(numStr,10);
    var note=mismatchNote(numStr,name);
    var res={valid:!!(numStr&&name),matched:false,num:num,recordName:'미분류',via:null,typedName:name,note:note,noteIfMismatch:note};
    if(!res.valid) return res;
    var lg=opts.allowLogin===false?null:login();
    if(lg && lg.num===num){   // 로그인한 본인: 이름을 조금 틀리게 써도 로그인 정보를 우선한다
      res.matched=true; res.via='login'; res.recordName=lg.name; res.note=''; res.noteIfMismatch=''; return res;
    }
    try{
      var r=await call({action:'verify',number:num,name:name});
      if(r.matched){ res.matched=true; res.via='typed'; res.recordName=r.name||name; res.note=''; res.noteIfMismatch=''; }
    }catch(e){ /* 연결 실패·제한: 미분류로 남긴다 */ }
    return res;
  }

  // 게임 점수를 순위표 기록에 올린다. 서버가 학생을 다시 확인하고 이름·번호를 정한다. 실패해도 조용히 넘어간다.
  async function boardPost(st,xp,src){
    try{
      if(!st||!st.matched||!(xp>0)) return false;
      var body={action:'board_post',xp:Math.min(200,Math.floor(xp)),src:src||'practice'};
      if(st.via==='login'){ var t=await token(); if(!t) return false; body.jwt=t; }
      else { body.number=st.num; body.name=st.typedName; }
      await call(body,true); return true;
    }catch(e){ return false; }
  }

  // 순위표 기록: 로그인한 학생·교사만. 로그인이 없으면 code='login_required' 오류.
  async function boardList(){
    var t=null; try{ t=await token(); }catch(e){}
    if(!t){ var e=new Error('login_required'); e.code='login_required'; throw e; }
    return call({action:'board_list',jwt:t});
  }

  // 로그인한 학생이면 번호·이름 칸을 미리 채운다(고쳐 쓸 수 있다).
  function prefill(numEl,nameEl){
    try{
      var lg=login(); if(!lg||!numEl||!nameEl) return false;
      if(!numEl.value) numEl.value=lg.num;
      if(!nameEl.value) nameEl.value=lg.name;
      ['input','change'].forEach(function(ev){ numEl.dispatchEvent(new Event(ev,{bubbles:true})); nameEl.dispatchEvent(new Event(ev,{bubbles:true})); });
      return true;
    }catch(e){ return false; }
  }

  window.StudentID={login:login,resolve:resolve,boardPost:boardPost,boardList:boardList,prefill:prefill,nameKey:nameKey};
})();
