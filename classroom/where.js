/* 어느 페이지에 있는지 알려 주는 짧은 이름표(접속 표시용).
   학생 화면은 주소 대신 아래의 영문 이름표(key)만 서버에 보낸다. 시험·개인 기록 페이지는 key 를 비워(비공개) 보내지 않는다. */
(()=>{
  'use strict';
  // [주소 조각, key, 보여 줄 이름]  key '' = 비공개(위치를 알리지 않음)
  const T=[
    [/\/tests\/|\/unit-test|\/selfstudy|\/resetmind|\/invest|\/dcf|\/narrative|\/Pdf-splitter|쿠폰|운동장/,'',''],
    [/\/growth\//,'growth','성장 발표'],
    [/\/picturebook\//,'book','그림책 쓰기'],
    [/\/games\//,'games','옛 놀이 가게'],
    [/\/school-tool\//,'tool','교실 연결'],
    [/\/school\.html/,'school','방과후 이야기방'],
    [/\/education\.html/,'edu','교육 도구 모음'],
    [/분수|fraction/,'fraction','분수 놀이터'],
    [/multiply|곱셈/,'multiply','곱셈 연습'],
    [/division|나눗셈/,'division','나눗셈 연습'],
    [/writing/,'writing','글쓰기'],
    [/oldlife/,'oldlife','옛 생활'],
    [/rhythm/,'rhythm','리듬'],
    [/exercise|fight|onedraw/,'play','놀이 마당']
  ];
  const L={};T.forEach(t=>{if(t[1])L[t[1]]=t[2]});L.other='우리 홈페이지';
  function key(path){
    let p=String(path||location.pathname||'');
    try{p=decodeURIComponent(p)}catch(_){}
    for(const t of T)if(t[0].test(p))return t[1];
    return 'other';
  }
  window.__stWhere={key,label:k=>k?(L[k]||''):''};
})();
