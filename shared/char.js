/* 학생 캐릭터 그리기(조합형). 조합 코드 {b,c,e,m,h,a} → SVG. 사용자가 입력한 글자는 쓰지 않고 숫자만 쓴다.
   b 몸 모양 5 · c 색 10 · e 눈 8 · m 입 6 · h 모자 10(8,9 특별) · a 꾸밈 6(5 특별). 서버 char-hub/function.ts 의 SIZE·SPECIAL 과 같아야 한다. */
(function(){
  const NS='http://www.w3.org/2000/svg';
  const SIZE={b:5,c:10,e:8,m:6,h:10,a:6};
  const COLORS=['#fca5a5','#fdba74','#fde047','#86efac','#5eead4','#7dd3fc','#a5b4fc','#d8b4fe','#f9a8d4','#d6d3d1'];
  const INK='#1f2937';
  const NAMES={
    b:['동글이','네모','콩','뾰족','하트'],
    c:['분홍','주황','노랑','연두','민트','하늘','남색','보라','복숭아','회색'],
    e:['콩눈','반짝눈','웃는눈','졸린눈','별눈','윙크','하트눈','깜짝눈'],
    m:['방긋','활짝','오','고양이','메롱','씨익'],
    h:['없음','모자','털모자','리본','왕관','마법모자','꽃','새싹','별 왕관 ✨','무지개 ✨'],
    a:['없음','동그란 안경','볼터치','목도리','나비넥타이','반짝 ✨']
  };
  const BODY=[
    ['circle',{cx:50,cy:56,r:33}],
    ['rect',{x:17,y:23,width:66,height:66,rx:20}],
    ['ellipse',{cx:50,cy:56,rx:29,ry:35}],
    ['path',{d:'M50 20C66 20 90 78 84 85C78 91 22 91 16 85C10 78 34 20 50 20Z'}],
    ['path',{d:'M50 88C10 60 18 24 40 30C46 32 50 38 50 38C50 38 54 32 60 30C82 24 90 60 50 88Z'}]
  ];
  function n(tag,attrs,kids){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);(kids||[]).forEach(c=>e.appendChild(c));return e}
  function clamp(v,k){v=Number(v);return Number.isInteger(v)&&v>=0&&v<SIZE[k]?v:0}
  function normalize(p){p=p||{};return {b:clamp(p.b,'b'),c:clamp(p.c,'c'),e:clamp(p.e,'e'),m:clamp(p.m,'m'),h:clamp(p.h,'h'),a:clamp(p.a,'a')}}
  const L=(x1,y1,x2,y2,w)=>n('line',{x1,y1,x2,y2,stroke:INK,'stroke-width':w||3,'stroke-linecap':'round'});
  const P=(d,fill,stroke,w)=>n('path',{d,fill:fill||'none',stroke:stroke||'none','stroke-width':w||3,'stroke-linecap':'round','stroke-linejoin':'round'});
  const C=(cx,cy,r,fill,stroke,w)=>n('circle',{cx,cy,r,fill:fill||'none',stroke:stroke||'none','stroke-width':w||0});
  function eyes(e){const g=[];const xs=[38,62];
    xs.forEach((x,i)=>{
      if(e===0)g.push(C(x,50,3.6,INK));
      else if(e===1){g.push(C(x,50,6.5,INK));g.push(C(x+2,47.5,2.2,'#fff'))}
      else if(e===2)g.push(P('M'+(x-6)+' 53Q'+x+' 44 '+(x+6)+' 53','none',INK,3.2));
      else if(e===3)g.push(L(x-6,51,x+6,51,3.2));
      else if(e===4)g.push(P('M'+x+' 43L'+(x+2)+' 48.5L'+(x+7)+' 49L'+(x+3)+' 52.5L'+(x+4.5)+' 58L'+x+' 55L'+(x-4.5)+' 58L'+(x-3)+' 52.5L'+(x-7)+' 49L'+(x-2)+' 48.5Z','#facc15',INK,1.5));
      else if(e===5){if(i===0)g.push(C(x,50,3.6,INK));else g.push(P('M'+(x-6)+' 51Q'+x+' 46 '+(x+6)+' 51','none',INK,3.2))}
      else if(e===6)g.push(P('M'+x+' 56C'+(x-10)+' 49 '+(x-6)+' 43 '+x+' 48C'+(x+6)+' 43 '+(x+10)+' 49 '+x+' 56Z','#f43f5e'));
      else g.push(n('ellipse',{cx:x,cy:50,rx:4.5,ry:6.5,fill:INK}));
    });return g}
  function mouth(m){
    if(m===0)return [P('M42 64Q50 72 58 64','none',INK,3.2)];
    if(m===1)return [P('M40 63Q50 80 60 63Z','#7f1d1d',INK,2.5)];
    if(m===2)return [n('ellipse',{cx:50,cy:68,rx:4,ry:5,fill:'#7f1d1d'})];
    if(m===3)return [P('M40 64Q45 70 50 64Q55 70 60 64','none',INK,3)];
    if(m===4)return [P('M42 64Q50 71 58 64','none',INK,3.2),P('M47 67.5Q50 77 53 67.5Z','#fb7185',INK,1.5)];
    return [P('M39 63Q50 74 61 63','none',INK,3.2),L(43,66,57,66,1.6)];
  }
  function hat(h){
    if(h===1)return [P('M26 34Q50 4 74 34Z','#ef4444',INK,2),P('M24 34L82 34','none',INK,4)];
    if(h===2)return [P('M28 36Q50 8 72 36Z','#38bdf8',INK,2),C(50,13,5,'#fff',INK,1.5),P('M26 36H74','none',INK,4)];
    if(h===3)return [P('M50 28L30 18L32 36Z','#f472b6',INK,2),P('M50 28L70 18L68 36Z','#f472b6',INK,2),C(50,28,5,'#ec4899',INK,2)];
    if(h===4)return [P('M28 34L30 14L40 26L50 10L60 26L70 14L72 34Z','#fbbf24',INK,2)];
    if(h===5)return [P('M24 34H76L52 4Z','#7c3aed',INK,2),P('M30 28Q50 36 70 28','none','#fde047',3)];
    if(h===6)return [C(50,18,5,'#fde047',INK,1.5),C(50,10,5,'#f9a8d4',INK,1.5),C(50,26,5,'#f9a8d4',INK,1.5),C(42,18,5,'#f9a8d4',INK,1.5),C(58,18,5,'#f9a8d4',INK,1.5)];
    if(h===7)return [P('M50 28V16','none','#16a34a',3),P('M50 18Q38 8 36 18Q44 22 50 18Z','#4ade80',INK,1.5),P('M50 18Q62 8 64 18Q56 22 50 18Z','#4ade80',INK,1.5)];
    if(h===8)return [P('M28 34L30 14L40 26L50 8L60 26L70 14L72 34Z','#facc15',INK,2),C(50,20,3,'#ef4444'),C(34,22,2,'#38bdf8'),C(66,22,2,'#38bdf8')];
    if(h===9)return [P('M26 18Q50 2 74 18','none','#ef4444',3),P('M28 21Q50 6 72 21','none','#facc15',3),P('M30 24Q50 10 70 24','none','#22c55e',3),P('M32 27Q50 14 68 27','none','#3b82f6',3)];
    return [];
  }
  function acc(a){
    if(a===1)return [C(38,50,9,'none',INK,2.5),C(62,50,9,'none',INK,2.5),L(47,50,53,50,2.5)];
    if(a===2)return [n('ellipse',{cx:30,cy:60,rx:5,ry:3.2,fill:'#fb7185',opacity:.6}),n('ellipse',{cx:70,cy:60,rx:5,ry:3.2,fill:'#fb7185',opacity:.6})];
    if(a===3)return [P('M24 82Q50 96 76 82','none','#f97316',9),P('M62 86L68 98','none','#f97316',7)];
    if(a===4)return [P('M50 86L38 80L38 94Z','#2563eb',INK,1.5),P('M50 86L62 80L62 94Z','#2563eb',INK,1.5),C(50,87,3.5,'#1d4ed8',INK,1.5)];
    if(a===5)return [C(14,30,2.5,'#facc15'),C(88,44,2,'#38bdf8'),C(10,70,2,'#f472b6'),C(90,78,2.5,'#facc15'),C(22,50,1.5,'#fff')];
    return [];
  }
  /* 캐릭터 SVG 요소를 만든다. size 는 화면 픽셀(정사각형). parts 가 없으면 null(아직 안 만든 친구). */
  function svg(parts,size){
    if(!parts)return null;
    const p=normalize(parts);
    const [tag,at]=BODY[p.b];
    const body=n(tag,Object.assign({fill:COLORS[p.c],stroke:INK,'stroke-width':3},at));
    const root=n('svg',{viewBox:'0 0 100 100',width:size||48,height:size||48,role:'img','aria-label':'캐릭터'},[
      n('g',{},[body].concat(acc(p.a).slice(0,p.a===3||p.a===4?2:0),eyes(p.e),mouth(p.m),acc(p.a).slice(p.a===3||p.a===4?2:0),hat(p.h)))
    ]);
    return root;
  }
  window.CharArt={SIZE,NAMES,COLORS,normalize,svg,SPECIAL:{h:[8,9],a:[5]}};
})();
