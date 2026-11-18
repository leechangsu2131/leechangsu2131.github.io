/*! 게임 시간 제한 (기기 기준) — 선생님 화면(games/teacher.html)의 "게임 시간 설정"을 읽어 적용합니다.
 *  - 게임 열림/닫힘, 하루 N번, 한 번에 M분
 *  - 서버를 읽지 못하면 막지 않습니다(수업이 멈추지 않게).
 *  - 사용: <script src="/shared/play-limit.js" data-key="yut"></script>  (페이지 전체를 지킴)
 *          또는 PlayLimit.begin(key) / PlayLimit.watch(key,start,onEnd) / PlayLimit.block(res)
 */
(function(){
  "use strict";
  var RPC="https://erzdvlcbjneabxqwnwfy.supabase.co/rest/v1/rpc/shop_public_play_rules";
  var KEY="sb_publishable_29w26VjvhHwI5O6iKOXTwA_sSTKUhfz";
  var rules=null,rulesAt=0,POLL=20000;

  function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}}
  function day(){var d=new Date();return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2)}
  function exempt(){return ls("playlimit.exempt")==="1"}   /* 선생님 기기(교사 화면에서 설정) */
  function json(k){try{return JSON.parse(ls(k))}catch(e){return null}}

  function fetchRules(force){
    if(!force&&rules&&Date.now()-rulesAt<POLL)return Promise.resolve(rules);
    return fetch(RPC,{method:"POST",cache:"no-store",headers:{apikey:KEY,Authorization:"Bearer "+KEY,"Content-Type":"application/json"},body:"{}"})
      .then(function(r){return r.ok?r.json():null})
      .then(function(d){var x=d&&d[0];if(!x)return rules;rules={open:x.open!==false,daily:+x.daily||0,minutes:+x.minutes||0,epoch:+x.epoch||0};rulesAt=Date.now();return rules})
      .catch(function(){return rules});
  }
  function counter(r){var c=json("playlimit.count");if(!c||c.d!==day()||c.e!==r.epoch)c={d:day(),e:r.epoch,n:0};return c}
  function usedLeft(r){return r.daily>0?Math.max(0,r.daily-counter(r).n):null}

  /* 한 번 "게임을 시작"하는 것을 세어요. 같은 게임을 한 번 시작한 뒤 새로고침해도 시간 안에서는 같은 한 번으로 봐요. */
  function begin(key){
    if(exempt())return Promise.resolve({ok:true,exempt:true});
    return fetchRules(true).then(function(r){
      if(!r)return {ok:true};
      if(!r.open)return {ok:false,reason:"closed",rules:r};
      var len=r.minutes>0?r.minutes:30,now=Date.now(),s=json("playlimit.s."+key),c=counter(r);
      var valid=s&&s.d===day()&&s.e===r.epoch&&now-s.s<len*60000;
      if(!valid){
        if(r.daily>0&&c.n>=r.daily)return {ok:false,reason:"daily",rules:r,left:0};
        c.n++;ls("playlimit.count",JSON.stringify(c));
        s={s:now,d:day(),e:r.epoch};ls("playlimit.s."+key,JSON.stringify(s));
      }
      return {ok:true,rules:r,start:s.s,left:usedLeft(r)};
    });
  }

  /* ---- 화면 ---- */
  var css="#plOv{position:fixed;inset:0;z-index:2147483000;background:rgba(8,10,16,.94);color:#f5f5f7;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;text-align:center}"+
    "#plOv .b{max-width:420px}#plOv .e{font-size:64px;line-height:1.1}#plOv h2{font-size:26px;margin:12px 0 8px}#plOv p{font-size:17px;line-height:1.6;color:#cfd4db;margin:0 0 18px}"+
    "#plOv button{font:inherit;font-size:17px;font-weight:700;cursor:pointer;border:0;border-radius:99px;padding:12px 26px;background:#fff;color:#000;margin:4px}#plOv button.g{background:rgba(255,255,255,.14);color:#fff}"+
    "#plBadge{position:fixed;right:12px;bottom:12px;z-index:2147482000;background:rgba(15,18,24,.86);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:99px;padding:6px 14px;font:700 15px/1.2 -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;pointer-events:none;display:none}"+
    "#plBadge.w{background:#b45309}#plBadge.d{background:#b91c1c}";
  function injectCss(){if(document.getElementById("plCss"))return;var s=document.createElement("style");s.id="plCss";s.textContent=css;(document.head||document.documentElement).appendChild(s)}
  function msg(res){
    var left=res.left;
    if(res.reason==="budget")return {e:"😴",h:"오늘 방과후 게임은 여기까지!",p:"하루 30분을 모두 썼어요. 내일 또 만나요."};
    if(res.reason==="closed")return {e:"🔒",h:"지금은 게임 시간이 아니에요",p:"선생님이 게임을 열어 주면 할 수 있어요."};
    if(res.reason==="daily")return {e:"😴",h:"오늘 게임은 여기까지!",p:"오늘 할 수 있는 "+(res.rules?res.rules.daily:"")+"번을 모두 했어요. 내일 또 만나요."};
    return {e:"⏰",h:"시간이 끝났어요",p:left===0?"오늘 할 수 있는 게임을 모두 했어요. 내일 또 만나요.":(left>0?"오늘 "+left+"번 더 할 수 있어요.":"쉬었다가 다시 시작해도 좋아요.")};
  }
  function block(res,opt){
    opt=opt||{};injectCss();unblock();
    var m=msg(res),ov=document.createElement("div");ov.id="plOv";ov.setAttribute("role","alertdialog");
    var canRetry=res.reason==="closed"||(res.reason==="time"&&res.left!==0);
    ov.innerHTML='<div class="b"><div class="e">'+m.e+'</div><h2>'+m.h+'</h2><p>'+m.p+'</p><div id="plBtns"></div></div>';
    var box=ov.querySelector("#plBtns");
    if(canRetry&&opt.onRetry){var b=document.createElement("button");b.textContent=res.reason==="closed"?"다시 확인하기":"새로 시작하기";b.onclick=opt.onRetry;box.appendChild(b)}
    if(opt.onClose){var c=document.createElement("button");c.className="g";c.textContent="닫기";c.onclick=function(){unblock();opt.onClose()};box.appendChild(c)}
    document.body.appendChild(ov);
    if(!opt.noScrollLock)document.documentElement.style.overflow="hidden";
  }
  function unblock(){var o=document.getElementById("plOv");if(o)o.parentNode.removeChild(o);document.documentElement.style.overflow=""}

  /* 남은 시간 표시 + 열림/닫힘·시간 변경을 20초마다 다시 확인해요. onEnd(res)는 시간이 끝나거나 닫혔을 때 한 번 불려요. */
  function watch(key,start,onEnd){
    injectCss();
    var bd=document.getElementById("plBadge");
    if(!bd){bd=document.createElement("div");bd.id="plBadge";document.body.appendChild(bd)}
    var done=false,t1,t2;
    function stop(){done=true;clearInterval(t1);clearInterval(t2);bd.style.display="none"}
    function end(res){if(done)return;stop();onEnd&&onEnd(res)}
    function tick(){
      if(done)return;var r=rules;
      if(!r||!r.minutes){bd.style.display="none";return}
      var rem=start+r.minutes*60000-Date.now();
      if(rem<=0){end({ok:false,reason:"time",rules:r,left:usedLeft(r)});return}
      var s=Math.ceil(rem/1000),mm=Math.floor(s/60),ss=("0"+(s%60)).slice(-2);
      bd.textContent="⏱ "+mm+":"+ss;bd.className=s<=10?"d":(s<=60?"w":"");bd.style.display="block";
    }
    function poll(){fetchRules(true).then(function(r){if(done||!r)return;if(!r.open)end({ok:false,reason:"closed",rules:r});else tick()})}
    t1=setInterval(tick,1000);t2=setInterval(poll,POLL);tick();
    return stop;
  }

  /* 페이지 전체를 지켜요 */
  function guardPage(key){
    if(exempt())return;
    function run(){
      begin(key).then(function(res){
        if(!res.ok){block(res,{onRetry:run});return}
        unblock();
        watch(key,res.start||Date.now(),function(r){block(r,{onRetry:run})});
      });
    }
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();
  }

  window.PlayLimit={begin:begin,watch:watch,block:block,unblock:unblock,guardPage:guardPage,exempt:exempt,
    setExempt:function(on){ls("playlimit.exempt",on?"1":null)}};

  var cs=document.currentScript;
  if(cs&&cs.getAttribute("data-key"))guardPage(cs.getAttribute("data-key"));
})();
