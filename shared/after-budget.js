/*! 방과후 게임 하루 합계 시간 (기기 기준)
 *  school.html 의 「🎮 게임」에서 들어온 경우에만(games/index.html?from=school) 적용됩니다. 수업 시간에 쓰는 게임에는 영향이 없어요.
 *  - 하루 LIMIT_MIN 분까지: 게임 창이 열려 있고 화면을 보고 있는 시간만 더해요.
 *  - 한계: 이 기기의 브라우저에만 저장돼서 사이트 데이터 삭제·시크릿 창으로 우회할 수 있어요(기존 PlayLimit 과 같음).
 *  - 선생님 기기: playlimit.exempt 가 켜져 있으면 제한하지 않아요(games/teacher.html 의 「이 기기는 제한 없음」).
 *  분을 바꾸려면 아래 LIMIT_MIN 숫자만 고치세요. */
(function(){
  "use strict";
  var LIMIT_MIN=30;
  function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){return null}}
  function ss(k,v){try{if(v===undefined)return sessionStorage.getItem(k);if(v===null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,v)}catch(e){return null}}
  function day(){var d=new Date();return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2)}
  function key(){return "afterplay."+day()}
  function used(){var n=parseInt(ls(key()),10);return n>0?n:0}
  window.AfterBudget={
    limitSec:LIMIT_MIN*60,
    exempt:function(){return ls("playlimit.exempt")==="1"},
    /* 방과후에서 들어왔는지: URL 에 from=school 이 있으면 켜고, 없으면 끈다(수업용 접속은 제한 없음) */
    sync:function(){var f=/[?&]from=school\b/.test(location.search);if(f)ss("ps_after","1");else ss("ps_after",null);return f},
    on:function(){return ss("ps_after")==="1"},                 /* 방과후에서 들어왔는지(선생님 기기도 시간은 센다) */
    limited:function(){return this.on()&&!this.exempt()},       /* 실제로 막는지(선생님 기기는 막지 않는다) */
    used:used,
    left:function(){return Math.max(0,this.limitSec-used())},
    add:function(sec){ls(key(),String(used()+sec))},
    fmt:function(sec){var m=Math.floor(sec/60),s=("0"+(sec%60)).slice(-2);return m+":"+s}
  };
})();
