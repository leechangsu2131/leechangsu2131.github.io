/* 교육 도구 모음(education.html) 입장 관리: 로그인 / 게스트
 * - 로그인: school-tool/index.html 에서 한 로그인(sessionStorage 'st_s')이 있으면 학생 모드.
 * - 게스트: 로그인 없이 둘러보기(sessionStorage 'site_guest'). 학급 전용 도구(data-login)는 잠긴다.
 * ※ 정적 페이지의 안내용 문이다. 진짜 보호는 각 페이지·서버(번호+이름 확인, 교사 로그인)가 한다. */
(function(){
  var KS='st_s',KG='site_guest',KN='st_next';
  function get(k){try{return sessionStorage.getItem(k)}catch(e){return null}}
  function set(k,v){try{sessionStorage.setItem(k,v)}catch(e){}}
  function del(k){try{sessionStorage.removeItem(k)}catch(e){}}
  var me=null;try{me=JSON.parse(get(KS)||'null')}catch(e){}
  var mode=(me&&(me.access||me.name))?'student':(get(KG)?'guest':null);

  var css=document.createElement('style');
  css.textContent='.acc-gate{position:fixed;inset:0;z-index:99999;background:rgba(5,5,7,.88);backdrop-filter:blur(10px);display:grid;place-items:center;padding:18px}'
  +'.acc-box{width:min(440px,100%);background:#1c1c22;border:1px solid rgba(255,255,255,.14);border-radius:24px;padding:28px 24px;text-align:center;color:#f5f5f7;font-family:inherit}'
  +'.acc-box h2{font-size:24px;margin:0 0 6px;letter-spacing:-.03em}.acc-box p{color:#a1a1aa;margin:6px 0 18px;font-size:15px}'
  +'.acc-box button{display:block;width:100%;font:inherit;font-weight:700;font-size:17px;padding:14px;border-radius:14px;border:0;cursor:pointer;margin-top:10px}'
  +'.acc-in{background:#64d2ff;color:#04202b}.acc-guest{background:transparent;color:#f5f5f7;border:1px solid rgba(255,255,255,.25)!important}'
  +'.acc-box small{display:block;color:#a1a1aa;margin-top:14px;font-size:13px}'
  +'.tool.locked{opacity:.55}.tool.locked .lk{margin-left:6px;font-size:12px;color:#ff9f0a;font-weight:700}';
  document.head.appendChild(css);

  function goLogin(){set(KN,'education.html');location.href='school-tool/index.html'}
  function gate(msg){
    if(document.getElementById('accGate'))return;
    var g=document.createElement('div');g.className='acc-gate';g.id='accGate';g.setAttribute('role','dialog');g.setAttribute('aria-modal','true');
    g.innerHTML='<div class="acc-box"><h2>🌱 교육 도구 모음</h2><p></p>'
      +'<button class="acc-in" type="button">🔑 로그인하고 들어가기</button>'
      +'<button class="acc-guest" type="button">👀 게스트로 둘러보기</button>'
      +'<small>게스트는 연습 도구만 쓸 수 있어요. 우리 반 전용 도구는 로그인이 필요해요.</small></div>';
    g.querySelector('p').textContent=msg||'우리 반 친구는 로그인하고, 둘러보기만 하려면 게스트로 들어와요.';
    g.querySelector('.acc-in').onclick=goLogin;
    g.querySelector('.acc-guest').onclick=function(){set(KG,'1');mode='guest';g.remove();apply()};
    document.body.appendChild(g);g.querySelector('.acc-in').focus();
  }
  function apply(){
    // 잠금: 게스트일 때 학급 전용 도구
    [].forEach.call(document.querySelectorAll('.tool[data-login]'),function(a){
      if(mode==='student'){a.classList.remove('locked');var o=a.getAttribute('data-href');if(o){a.setAttribute('href',o)}var lk=a.querySelector('.lk');if(lk)lk.remove();return}
      if(!a.getAttribute('data-href'))a.setAttribute('data-href',a.getAttribute('href'));
      a.setAttribute('href','#');a.setAttribute('aria-disabled','true');a.classList.add('locked');
      if(!a.querySelector('.lk')){var b=a.querySelector('b');if(b){var s=document.createElement('span');s.className='lk';s.textContent='🔒 로그인 필요';b.appendChild(s)}}
      if(!a._accBound){a._accBound=true;a.addEventListener('click',function(e){if(mode!=='student'){e.preventDefault();gate('이 도구는 우리 반 로그인이 필요해요.')}})}
    });
    // 상태 표시(메뉴 맨 끝)
    var nav=document.querySelector('nav');if(!nav)return;
    var s=document.getElementById('accMode');if(!s){s=document.createElement('a');s.id='accMode';s.href='#';nav.appendChild(s)}
    s.textContent=mode==='student'?('👤 '+((me&&me.num)?me.num+'번 · ':'')+'로그아웃'):'👀 게스트 · 로그인';
    s.onclick=function(e){e.preventDefault();if(mode==='student'){del(KS);del(KG);del(KN);location.reload()}else{goLogin()}};
  }
  if(!mode)gate();
  apply();
})();
