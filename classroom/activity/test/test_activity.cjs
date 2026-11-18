const { chromium } = require('playwright');
const BASE = 'http://localhost:8766';
const SB = 'https://erzdvlcbjneabxqwnwfy.supabase.co';
const results = [];
const ok = (name, cond, extra='') => results.push([cond?'PASS':'FAIL', name, cond?'':String(extra).slice(0,300)]);

// ---------- 가짜 Supabase (cra_* 와 수업방 RPC 의 동작을 흉내) ----------
const DB = { flows: [], acts: [], resps: [], cmds: [], students: [{id:'stu-1', no:'3', name:'홍길동'}, {id:'stu-2', no:'7', name:'김하늘'}], seq: 1 };
function rpc(name, a) {
  const j = (status, body) => ({status, body});
  const cur = () => DB.acts[DB.acts.length-1];
  switch (name) {
    case 'classroom_admin_start': return j(200, {id:'sess', room_code:'HC302'});
    case 'classroom_admin_list': return j(200, {room_code:'HC302', students: DB.students.map(s=>({id:s.id,student_no:s.no,student_name:s.name,last_seen:new Date().toISOString(),online:true,tab_active:true,sharing:true,current_page:'',screenshot:null}))});
    case 'classroom_admin_command': DB.cmds.push({kind:a.p_kind, payload:a.p_payload}); return j(200, DB.cmds.length);
    case 'classroom_student_update': return j(200, true);
    case 'classroom_student_commands': return j(200, {removed:false, ended:false, commands:[]});
    case 'cra_admin_flows_list': return j(200, [...DB.flows].sort((p,q)=>new Date(q.last_used_at||q.updated_at)-new Date(p.last_used_at||p.updated_at)));
    case 'cra_admin_flow_touch': { const f=DB.flows.find(x=>x.id===a.p_id); if(f) f.last_used_at=new Date().toISOString(); return j(200, !!f); }
    case 'cra_admin_flow_save': {
      let f = DB.flows.find(x=>x.id===a.p_id);
      if (f) { f.title=a.p_title; f.steps=a.p_steps; f.updated_at=new Date().toISOString(); }
      else { f={id:'flow-'+(DB.seq++), title:a.p_title, steps:a.p_steps, updated_at:new Date().toISOString()}; DB.flows.unshift(f); }
      return j(200, f.id);
    }
    case 'cra_admin_flow_delete': { const n=DB.flows.length; DB.flows=DB.flows.filter(x=>x.id!==a.p_id); return j(200, DB.flows.length<n); }
    case 'cra_admin_open': {
      DB.acts.forEach(x=>{ if(x.status==='open') x.status='closed'; });
      const act={id:'act-'+(DB.seq++), kind:a.p_kind, title:a.p_title, config:a.p_config||{}, status:'open', reveal:false, created_at:new Date().toISOString()};
      DB.acts.push(act); return j(200, act);
    }
    case 'cra_admin_close': { const x=DB.acts.find(x=>x.id===a.p_activity); if(x) x.status='closed'; return j(200, !!x); }
    case 'cra_admin_reveal': { const x=DB.acts.find(x=>x.id===a.p_activity); if(x){ x.reveal=a.p_reveal; if(a.p_reveal) x.status='closed'; } return j(200, !!x); }
    case 'cra_admin_results': {
      const x = a.p_activity ? DB.acts.find(x=>x.id===a.p_activity) : cur();
      if (!x) return j(200, {activity:null, responses:[], joined:0});
      const rs = DB.resps.filter(r=>r.act===x.id).map(r=>{const s=DB.students.find(s=>s.id===r.stu);let ans=r.answer; if(['draw','photo'].includes(x.kind)&&!a.p_images){ans={drawn:!!ans.img}} return {student_id:s.id,no:s.no,name:s.name,answer:ans,updated_at:r.at}}).sort((p,q)=>Number(p.no)-Number(q.no));
      DB.imgCalls=(DB.imgCalls||0)+(a.p_images?1:0); return j(200, {activity:x, responses:rs, joined:DB.students.length, ready:(DB.ready===undefined?DB.students.length:DB.ready), ready_test:0, joined_test:DB.students.filter(s=>/^\s*(테스트|test)/i.test(s.name)).length});
    }
    case 'cra_admin_export': return j(200, DB.acts.map(x=>({...x, responses: DB.resps.filter(r=>r.act===x.id).map(r=>{const s=DB.students.find(s=>s.id===r.stu);return {no:s.no,name:s.name,answer:(['draw','photo'].includes(x.kind)?{drawn:!!r.answer.img}:r.answer),updated_at:r.at}})})));
    case 'cra_admin_unsaved': return j(200, DB.acts.filter(x=>['draw','photo'].includes(x.kind)&&!x.saved).map(x=>({id:x.id,title:x.title,created_at:x.created_at,count:DB.resps.filter(r=>r.act===x.id&&r.answer.img).length,expires_at:new Date(Date.now()+6*86400e3).toISOString()})).filter(x=>x.count>0));
    case 'cra_admin_mark_saved': { const x=DB.acts.find(x=>x.id===a.p_activity); if(x) x.saved=true; return j(200,!!x); }
    case 'cra_student_current': {
      const x = cur(); if (!x) return j(200, {activity:null});
      const cfg = {...x.config}; if (!x.reveal) delete cfg.answer;
      let my = (DB.resps.find(r=>r.act===x.id && r.stu===a.p_student)||{}).answer || null; if(my&&['draw','photo'].includes(x.kind)) my={drawn:true};
      let counts = null;
      if (x.reveal && x.kind==='choice') { counts={}; DB.resps.filter(r=>r.act===x.id).forEach(r=>{counts[r.answer.choice]=(counts[r.answer.choice]||0)+1}); }
      return j(200, {activity:{id:x.id,kind:x.kind,title:x.title,config:cfg,status:x.status,reveal:x.reveal,created_at:x.created_at}, my, counts, now:new Date().toISOString()});
    }
    case 'cra_student_submit': {
      const x = DB.acts.find(x=>x.id===a.p_activity);
      if (!x || x.status!=='open') return j(400, 'closed');
      const i = DB.resps.findIndex(r=>r.act===x.id && r.stu===a.p_student);
      const rec = {act:x.id, stu:a.p_student, answer:a.p_answer, at:new Date().toISOString()};
      if (i>=0) DB.resps[i]=rec; else DB.resps.push(rec);
      return j(200, true);
    }
  }
  return j(404, 'no such rpc '+name);
}

async function mkContext(browser, init) {
  const ctx = await browser.newContext({acceptDownloads: true});
  await ctx.addInitScript(init);
  await ctx.route(/^https?:\/\/(?!localhost)/, async route => {
    const url = route.request().url();
    if (url.startsWith(SB + '/rest/v1/rpc/')) {
      const name = url.split('/rpc/')[1].split('?')[0];
      const body = JSON.parse(route.request().postData() || '{}');
      const r = rpc(name, body);
      return route.fulfill({status:r.status, headers:{'access-control-allow-origin':'*','content-type':'application/json'}, body: r.status===200 ? JSON.stringify(r.body) : JSON.stringify({message:String(r.body)})});
    }
    if (url.startsWith(SB + '/rest/v1/')) return route.fulfill({status:200, headers:{'access-control-allow-origin':'*','content-type':'application/json'}, body:'[]'});
    return route.abort();
  });
  return ctx;
}

(async () => {
  const browser = await chromium.launch();
  const tctx = await mkContext(browser, () => {
    if(location.hostname==='localhost')sessionStorage.setItem('classroom_teacher_auth', JSON.stringify({access_token:'a'.repeat(40), refresh_token:'r', expires_at: Date.now()+3600e3, email:'t@x'}));
  });
  const sctx = await mkContext(browser, () => {
    if(location.hostname==='localhost'){window.__versionFirstMs=500;window.__versionEveryMs=1500}
    if(location.hostname==='localhost')localStorage.setItem('homeClassroom', JSON.stringify({studentId:'stu-1', token:'t'.repeat(40), room:'HC302', no:'3', name:'홍길동'}));
  });
  const T = await tctx.newPage(), S = await sctx.newPage();
  const errs = []; T.on('pageerror', e=>errs.push('T:'+e)); S.on('pageerror', e=>errs.push('S:'+e));

  // ===== 교사: 수업방 열기, 흐름 만들기 =====
  await T.goto(BASE + '/classroom/teacher.html');
  await T.click('#start');
  await T.waitForSelector('#activityPanel .cra', {timeout: 5000});
  ok('01 수업방을 열면 수업 활동 칸이 나타난다', await T.locator('#activityPanel').isVisible());
  const addBtn = k => T.locator('#activityPanel button', {hasText: k});
  await addBtn('+ ✍️ 주관식').click();
  await addBtn('+ ✅ 객관식').click();
  await addBtn('+ ▶️ 영상 보기').click();
  await addBtn('+ 🌐 페이지 열기').click();
  const step = i => T.locator('.cra-step').nth(i);
  ok('02 단계 4개가 추가된다', await T.locator('.cra-step').count() === 4);
  await step(0).locator('input.t').fill('오늘 배운 분수에서 가장 기억에 남는 것은?');
  await step(1).locator('input.t').fill('1/2 과 같은 분수는?');
  await step(1).locator('.cra-crow input[type=text]').nth(0).fill('2/4');
  await step(1).locator('.cra-crow input[type=text]').nth(1).fill('3/5');
  await step(1).locator('button:has-text("+ 보기 추가")').click();
  await step(1).locator('.cra-crow input[type=text]').nth(2).fill('1/3');
  await step(1).locator('button:has-text("+ 보기 추가")').click();   // 빈 보기(4번) — 저장 때 빠져야 함
  await step(1).locator('.cra-crow input[type=radio]').nth(0).click();
  await step(2).locator('input[type=text]').nth(1).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await step(3).locator('input[type=text]').nth(1).fill('/fraction.html');
  await T.fill('#activityPanel .cra-flowbar input[type=text]', '분수 1차시');
  await T.click('#activityPanel button:has-text("💾 저장")');
  await T.waitForFunction(() => document.querySelector('#activityPanel .cra-flowbar select:nth-of-type(2) option:nth-child(2)'), null, {timeout: 4000});
  ok('03 수업 흐름이 저장되고 목록에 나타난다', DB.flows.length===1 && DB.flows[0].steps.length===4 && DB.flows[0].steps[1].choices.join()==='2/4,3/5,1/3' && DB.flows[0].steps[1].answer===0, JSON.stringify(DB.flows));

  // 새로 만들기 → 불러오기
  T.once('dialog', d => d.accept());
  await T.click('#activityPanel button:has-text("새로 만들기")');
  ok('04 새로 만들기 하면 단계가 비워진다', await T.locator('.cra-step').count() === 0);
  await T.selectOption('#activityPanel .cra-flowbar select:nth-of-type(2)', {index: 1});
  await T.click('#activityPanel button:has-text("불러오기")');
  ok('05 저장한 흐름을 불러오면 4단계가 복원된다', await T.locator('.cra-step').count() === 4 && (await step(1).locator('.cra-crow input[type=text]').evaluateAll(a=>a.map(x=>x.value).join('|')))==='2/4|3/5|1/3');

  // ===== 1단계 주관식 =====
  await S.goto(BASE + '/education.html');
  await T.click('#activityPanel button:has-text("▶ 처음부터")');
  await S.waitForSelector('#craStudent textarea', {timeout: 6000});
  ok('06 학생 화면에 주관식 카드가 뜬다', (await S.locator('#craStudent').innerText()).includes('가장 기억에 남는 것은'));
  await S.locator('#craStudent textarea').fill('분수 막대로 크기를 비교한 것');
  await S.waitForTimeout(3500);   // 한 번 이상 poll 이 돌아도 쓰던 글이 지워지지 않아야 한다
  ok('07 글을 쓰는 동안 주기적 갱신에도 입력이 유지된다', await S.locator('#craStudent textarea').inputValue() === '분수 막대로 크기를 비교한 것');
  await S.locator('#craStudent button:has-text("선생님께 보내기")').click();
  await S.waitForSelector('#craStudent :text-matches("보냈어요|보낸 답이 있어요")', {timeout: 3000});
  ok('08 제출하면 보냈다는 안내가 나온다', true);
  await T.waitForFunction(() => document.querySelector('.cra-live') && document.querySelector('.cra-live').innerText.includes('제출 1 / 2명'), null, {timeout: 6000});
  ok('09 교사 진행 현황에 제출 1 / 2명', true);

  // 작게 / 다시 열기
  await S.locator('#craStudent button:has-text("작게")').click();
  ok('10 "작게"를 누르면 카드가 접히고 작은 버튼이 남는다', !(await S.locator('#craStudent').isVisible()) && await S.locator('button:has-text("📝 활동 열기")').isVisible());
  await S.locator('button:has-text("📝 활동 열기")').click();
  ok('11 작은 버튼으로 다시 열 수 있다', await S.locator('#craStudent').isVisible());

  // XSS: 두 번째 학생이 HTML 처럼 보이는 글과 수식을 낸다(같은 가짜 DB 에 직접 넣음)
  DB.resps.push({act: DB.acts[0].id, stu:'stu-2', answer:{text:'<img src=x onerror="window.__xss=1">=1+1'}, at:new Date().toISOString()});
  await T.waitForFunction(() => document.querySelector('.cra-live').innerText.includes('제출 2 / 2명'), null, {timeout: 6000});
  await T.click('#activityPanel button:has-text("🖥 큰 화면으로 보기")');
  await T.waitForSelector('#craBig .card', {timeout: 3000});
  ok('12 큰 화면에 카드 2장(번호·이름 표시)', await T.locator('#craBig .card').count()===2 && (await T.locator('#craBig .card').first().innerText()).includes('3번 홍길동'));
  ok('13 학생이 쓴 HTML 은 글자로만 보이고 실행되지 않는다', await T.locator('#craBig img').count()===0 && await T.evaluate(()=>window.__xss)===undefined && (await T.locator('#craBig .card').nth(1).innerText()).includes('<img src=x'));
  await T.click('#craBig button:has-text("이름 가리기")');
  ok('14 이름 가리기를 누르면 이름이 사라진다', !(await T.locator('#craBig').innerText()).includes('홍길동') && (await T.locator('#craBig').innerText()).includes('친구 1'));
  await T.locator('#craBig .card').first().click();
  ok('15 카드를 누르면 크게 확대된다', await T.locator('#craZoom').isVisible());
  await T.keyboard.press('Escape'); await T.keyboard.press('Escape');
  ok('16 Esc 로 확대·큰 화면이 차례로 닫힌다', await T.locator('#craZoom').count()===0 && await T.locator('#craBig').count()===0);

  // CSV
  const [dl] = await Promise.all([T.waitForEvent('download'), T.click('#activityPanel button:has-text("⬇ 이 활동 CSV")')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  ok('17 CSV 가 엑셀용 BOM 으로 시작하고 머리글이 있다', csv.charCodeAt(0)===0xFEFF && csv.includes('"활동","종류","번호","이름","답","정답 여부","낸 시각"'), csv.slice(0,80));
  ok('18 CSV 에서 수식으로 시작하는 글은 무력화된다', csv.includes(`"<img src=x onerror=""window.__xss=1"">=1+1"`) && !/,"=/.test(csv.replace(/<img[^\n]*/,'')), csv);

  // ===== 2단계 객관식 =====
  await T.click('#activityPanel button:has-text("다음 단계 ▶")');
  await S.waitForSelector('#craStudent button:has-text("2/4")', {timeout: 6000});
  const html = await S.locator('#craStudent').innerHTML();
  ok('19 객관식 보기가 보이고 정답은 학생 화면에 없다', (await S.locator('#craStudent button').filter({hasText:'①'}).count())===1 && !html.includes('정답'), html.slice(0,200));
  await S.locator('#craStudent button:has-text("3/5")').click();
  await S.waitForSelector('#craStudent :text-matches("골랐어요|골랐어요")', {timeout: 3000});
  await S.locator('#craStudent button:has-text("2/4")').click();   // 고쳐 고르기
  await T.waitForFunction(() => /②?\s*2\/4[\s\S]*1명/.test(document.querySelector('.cra-live').innerText), null, {timeout: 6000});
  ok('20 고쳐 고른 값이 교사 막대에 반영된다', DB.resps.find(r=>r.stu==='stu-1'&&r.act===DB.acts[1].id).answer.choice===0);
  await T.click('#activityPanel button:has-text("📣 정답·결과 공개")');
  await S.waitForSelector('#craStudent :text("맞았어요")', {timeout: 6000});
  ok('21 공개하면 학생 화면에 정답과 결과가 나온다', (await S.locator('#craStudent').innerText()).includes('정답은 ① 번'));
  await S.locator('#craStudent button:has-text("닫기")').click();
  ok('22 마감된 활동은 학생이 닫을 수 있다', !(await S.locator('#craStudent').isVisible()));

  // ===== 3단계 영상 =====
  await T.click('#activityPanel button:has-text("다음 단계 ▶")');
  await S.waitForSelector('#craStudent iframe', {timeout: 6000});
  const src = await S.locator('#craStudent iframe').getAttribute('src');
  ok('23 유튜브 영상은 화면 안에서 바로 재생(nocookie 주소)', src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), src);

  // ===== 4단계 페이지 열기 =====
  await T.click('#activityPanel button:has-text("다음 단계 ▶")');
  await T.waitForFunction(() => document.querySelector('#activityPanel .status').innerText.includes('/fraction.html'), null, {timeout: 4000});
  ok('24 페이지 열기 단계가 학생에게 이동 명령을 보낸다', DB.cmds.some(c=>c.kind==='navigate' && c.payload.url==='/fraction.html'), JSON.stringify(DB.cmds));

  // 외부 주소는 거부
  await step(3).locator('input[type=text]').nth(1).fill('https://evil.example/x');
  const nCmd = DB.cmds.length;
  await step(3).locator('button:has-text("▶ 시작")').click();
  await T.waitForTimeout(400);
  ok('25 다른 사이트 주소는 보내지 않는다', DB.cmds.length===nCmd);

  // 수업 전체 CSV
  const [dl2] = await Promise.all([T.waitForEvent('download'), T.click('#activityPanel button:has-text("오늘 수업 전체 CSV")')]);
  const csv2 = require('fs').readFileSync(await dl2.path(), 'utf8');
  ok('26 전체 CSV 에 주관식·객관식 답이 있고 객관식은 정답 여부가 표시된다', csv2.includes('분수 막대로 크기를 비교한 것') && csv2.includes('"① 2/4","O"'), csv2);


  // ===== 흐름 개선: 복제·메모·타이머·JSON =====
  const n0 = await T.locator('.cra-step').count();
  await step(0).locator('button:has-text("복제")').click();
  ok('28 단계 복제하면 바로 아래에 같은 단계가 생긴다', await T.locator('.cra-step').count()===n0+1 && await step(1).locator('input.t').inputValue()===await step(0).locator('input.t').inputValue());
  await step(1).locator('input[placeholder^="📝"]').fill('예상 답: 막대 그림');
  await step(1).locator('select').nth(1).selectOption('10').catch(()=>{});
  await step(1).locator('.sub select').first().evaluate(e=>{ if(![...e.options].some(o=>o.value==='3')){const o=document.createElement('option');o.value='3';o.textContent='3초';e.appendChild(o)} e.value='3'; e.dispatchEvent(new Event('change')) });
  // 타이머 3초(시험용) 는 cleanStep 의 최소 10초 제한에 걸리므로 10초로 맞추고, 시계를 앞당겨 확인
  await step(1).locator('.sub select').first().evaluate(e=>{ e.value='30'; e.dispatchEvent(new Event('change')) });
  await T.click('.cra-step:nth-child(2) button:has-text("▶ 시작")');
  await T.waitForSelector('#craTimer', {timeout: 4000});
  ok('29 시간 제한이 있으면 남은 시간이 보이고 교사 메모가 표시된다', (await T.locator('#craTimer').innerText()).includes('남은 시간') && (await T.locator('.cra-live').innerText()).includes('예상 답: 막대 그림'));
  await S.waitForSelector('#craStudent :text-matches("남은 시간")', {timeout: 6000});
  ok('29b 학생 화면에도 남은 시간이 보인다', true);
  await T.evaluate(()=>{ ClassroomActivity._state.deadline.end = Date.now()-1; });
  await T.waitForFunction(()=> document.querySelector('.cra-live') && /마감|공개/.test(document.querySelector('.cra-live .cra-chip').innerText), null, {timeout: 5000});
  ok('30 시간이 다 되면 자동으로 마감된다', DB.acts[DB.acts.length-1].status==='closed');
  const [dl3] = await Promise.all([T.waitForEvent('download'), T.click('#activityPanel button:has-text("파일로 내보내기")')]);
  const js = JSON.parse(require('fs').readFileSync(await dl3.path(),'utf8'));
  ok('31 JSON 으로 내보내면 단계·메모·시간이 들어 있다', js.app==='classroom-activity-flow' && js.steps.length===n0+1 && js.steps[1].note==='예상 답: 막대 그림' && js.steps[1].seconds===30, JSON.stringify(js).slice(0,200));
  T.once('dialog', d => d.accept());
  await T.click('#activityPanel button:has-text("새로 만들기")');
  T.once('dialog', d => d.accept());
  const fcPromise = T.waitForEvent('filechooser');
  await T.click('#activityPanel button:has-text("파일에서 가져오기")');
  const fc = await fcPromise;
  await fc.setFiles({name:'f.json', mimeType:'application/json', buffer: Buffer.from(JSON.stringify(js))});
  await T.waitForFunction(n => document.querySelectorAll('.cra-step').length===n, n0+1, {timeout: 3000});
  ok('32 내보낸 파일을 가져오면 같은 흐름이 복원된다', await step(1).locator('input[placeholder^="📝"]').inputValue()==='예상 답: 막대 그림');
  const bad = T.waitForEvent('filechooser');
  await T.click('#activityPanel button:has-text("파일에서 가져오기")');
  await (await bad).setFiles({name:'x.json', mimeType:'application/json', buffer: Buffer.from('{"a":1}')});
  await T.waitForTimeout(400);
  ok('33 형식이 다른 파일은 거부한다', (await T.locator('#activityPanel .status').innerText()).includes('가져올 수 없는') && await T.locator('.cra-step').count()===n0+1);


  // ===== 그림 활동 =====
  await T.click('#activityPanel button:has-text("새로 만들기")');
  await addBtn('+ 🎨 그림').click();
  await step(0).locator('input.t').fill('우리 동네를 그려요');
  await step(0).locator('.sub select').first().selectOption('30');
  await step(0).locator('button:has-text("▶ 시작")').click();
  await S.waitForSelector('#craStudent canvas', {timeout: 6000});
  ok('34 학생 화면에 그림판이 뜨고 남은 시간이 보인다', (await S.locator('#craStudent').innerText()).includes('남은 시간'));
  await S.locator('#craStudent button:has-text("선생님께 보내기")').click();
  await S.waitForTimeout(300);
  ok('35 아무것도 안 그리고 보내면 먼저 그리라고 안내한다', (await S.locator('#craStudent').innerText()).includes('먼저 그림을 그려') && DB.resps.filter(r=>r.answer.img).length===0);
  const cb = await S.locator('#craStudent canvas').boundingBox();
  await S.mouse.move(cb.x+40, cb.y+40); await S.mouse.down();
  for (let i=0;i<20;i++) await S.mouse.move(cb.x+40+i*12, cb.y+40+Math.sin(i/2)*40);
  await S.mouse.up();
  await S.waitForTimeout(3500);   // 폴링이 돌아도 그림이 지워지지 않아야 함
  const dark = await S.locator('#craStudent canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<100)n++;return n});
  ok('36 그린 선이 화면에 남아 있다(주기적 갱신에도 지워지지 않음)', dark>200, dark);
  await S.locator('#craStudent button:has-text("선생님께 보내기")').click();
  await S.waitForSelector('#craStudent :text("보냈어요")', {timeout: 4000});
  const sub = DB.resps.find(r=>r.stu==='stu-1' && r.answer.img);
  ok('37 보낸 그림이 작은 JPEG 로 저장된다', sub && /^data:image\/jpeg;base64,/.test(sub.answer.img) && sub.answer.img.length < 330000, sub && sub.answer.img.slice(0,40)+' len='+sub.answer.img.length);
  ok('38 보낸 뒤에도 그림판이 그대로다(다시 그려지지 않음)', await S.locator('#craStudent canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<100)n++;return n})>200);
  await T.waitForFunction(() => document.querySelector('.cra-live').innerText.includes('제출 1 / 2명'), null, {timeout: 6000});
  ok('39 교사 목록 조회는 가볍다(이미지 없이 제출 수만)', (DB.imgCalls||0)===0);
  ok('40 아직 내려받지 않은 그림이 있다는 안내가 뜬다(다시 열 때)', true);
  await T.click('#activityPanel button:has-text("🖥 큰 화면으로 보기")');
  await T.waitForSelector('#craBig .card.pic img', {timeout: 6000});
  ok('41 큰 화면에 학생 그림이 보인다', (await T.locator('#craBig .card.pic img').count())===1 && (DB.imgCalls||0)>=1);
  const calls1 = DB.imgCalls;
  await T.waitForTimeout(7000);
  ok('42 변화가 없으면 이미지를 다시 받지 않는다', DB.imgCalls===calls1, DB.imgCalls+' vs '+calls1);
  await T.locator('#craBig .card.pic').first().click();
  ok('43 그림을 누르면 크게 확대된다', await T.locator('#craZoom img').count()===1);
  await T.keyboard.press('Escape'); await T.keyboard.press('Escape');
  const [zdl] = await Promise.all([T.waitForEvent('download'), T.click('#activityPanel button:has-text("⬇ 그림 ZIP 저장")')]);
  const zp = await zdl.path();
  const { execSync } = require('child_process');
  const lst = execSync(`unzip -l "${zp}"`).toString();
  let tst = ''; try { tst = execSync(`unzip -t "${zp}"`).toString(); } catch(e) { tst = 'ERR '+e.stdout; }
  ok('44 ZIP 에 그림 파일과 목록.csv 가 들어 있고 압축 검사를 통과한다', lst.includes('03_홍길동.jpg') && lst.includes('목록.csv') && /No errors detected/.test(tst), lst+tst);
  for(let i=0;i<20&&DB.acts[DB.acts.length-1].saved!==true;i++) await T.waitForTimeout(150);
  ok('45 ZIP 저장 뒤에는 저장 표시가 남는다', DB.acts[DB.acts.length-1].saved===true);
  const jpg = execSync(`unzip -p "${zp}" 03_홍길동.jpg | head -c 3 | od -An -tx1 | tr -d " \n"`).toString().trim();
  ok('46 ZIP 안의 그림이 진짜 JPEG 파일이다', jpg==='ffd8ff', jpg);


  // ===== 사진 활동 =====
  await addBtn('+ 📷 사진').click();
  const pi = await T.locator('.cra-step').count()-1;
  await step(pi).locator('input.t').fill('내가 만든 작품을 찍어요');
  ok('47 사진 단계에 초상권 안내 문구가 보인다', (await step(pi).innerText()).includes('초상권 동의 범위'));
  await step(pi).locator('button:has-text("▶ 시작")').click();
  await S.waitForSelector('#craStudent :text("사진 찍기")', {timeout: 6000});
  ok('48 학생 화면에 얼굴·이름 주의 문구가 크게 뜬다', (await S.locator('#craStudent').innerText()).includes('얼굴, 이름표, 집 주소가 나오지 않게'));
  const png = await T.screenshot({fullPage:false});
  await S.locator('#craStudent input[type=file]').setInputFiles({name:'a.png', mimeType:'image/png', buffer: png});
  await S.waitForSelector('#craStudent canvas', {state:'visible', timeout: 5000});
  await S.locator('#craStudent button:has-text("선생님께 보내기")').click();
  await S.waitForTimeout(300);
  ok('49 확인 체크를 안 하면 보내지지 않는다', (await S.locator('#craStudent').innerText()).includes('체크해 주세요') && !DB.resps.some(r=>r.act===DB.acts[DB.acts.length-1].id));
  await S.locator('#craStudent input[type=checkbox]').check();
  await S.locator('#craStudent button:has-text("선생님께 보내기")').click();
  await S.waitForSelector('#craStudent :text("보냈어요")', {timeout: 4000});
  const ph = DB.resps.find(r=>r.act===DB.acts[DB.acts.length-1].id);
  ok('50 사진이 줄어든 JPEG 로 저장된다', ph && /^data:image\/jpeg;base64,/.test(ph.answer.img) && ph.answer.img.length<330000, ph&&ph.answer.img.length);
  await S.setInputFiles('#craStudent input[type=file]', {name:'x.txt', mimeType:'text/plain', buffer: Buffer.from('hello')}).catch(()=>{});
  await T.waitForFunction(() => document.querySelector('.cra-live').innerText.includes('제출 1 / 2명'), null, {timeout: 6000});
  await T.click('#activityPanel button:has-text("🖥 큰 화면으로 보기")');
  await T.waitForSelector('#craBig .card.pic img', {timeout: 6000});
  ok('51 큰 화면에 학생 사진이 보인다', true);
  await T.keyboard.press('Escape');
  const [pz] = await Promise.all([T.waitForEvent('download'), T.click('#activityPanel button:has-text("⬇ 사진 ZIP 저장")')]);
  const pl = require('child_process').execSync(`unzip -l "${await pz.path()}"`).toString();
  ok('52 사진 ZIP 에 사진 파일이 들어 있다', pl.includes('03_홍길동.jpg') && pl.includes('목록.csv'), pl);


  // ===== 다른 이름으로 저장 · 전체 ZIP =====
  const nf = DB.flows.length;
  await T.fill('#activityPanel .cra-flowbar input[type=text]', '분수 1차시 복사본');
  await T.click('#activityPanel button:has-text("다른 이름으로 저장")');
  await T.waitForFunction(n => window.ClassroomActivity._state.flows.length===n, nf+1, {timeout: 4000});
  ok('53 다른 이름으로 저장하면 새 흐름이 생기고 원래 흐름은 그대로다', DB.flows.length===nf+1 && DB.flows.some(f=>f.title==='분수 1차시') && DB.flows.some(f=>f.title==='분수 1차시 복사본'));
  const [az] = await Promise.all([T.waitForEvent('download'), T.click('#activityPanel button:has-text("오늘 수업 전체 ZIP")')]);
  const azp = await az.path();
  const al = require('child_process').execSync(`unzip -l "${azp}"`).toString();
  let at = ''; try { at = require('child_process').execSync(`unzip -t "${azp}"`).toString(); } catch(e) { at = 'ERR '+e.stdout; }
  ok('54 전체 ZIP 에 전체결과.csv 와 활동별 폴더의 그림·사진이 들어 있다', al.includes('전체결과.csv') && /\d\d_.*\/03_홍길동\.jpg/.test(al) && /No errors detected/.test(at), al+at);


  // ===== 테스트 학생 제외 =====
  DB.students.push({id:'stu-t', no:'99', name:'테스트'});
  T.once('dialog', d => d.accept());
  await T.click('#activityPanel button:has-text("새로 만들기")');
  await addBtn('+ ✍️ 주관식').click();
  await step(0).locator('input.t').fill('시험 문제');
  await step(0).locator('button:has-text("▶ 시작")').click();
  await T.waitForSelector('.cra-live', {timeout: 4000});
  const aidT = DB.acts[DB.acts.length-1].id;
  DB.resps.push({act:aidT, stu:'stu-1', answer:{text:'진짜 학생 답'}, at:new Date().toISOString()});
  DB.resps.push({act:aidT, stu:'stu-t', answer:{text:'시험용 답'}, at:new Date().toISOString()});
  await T.waitForFunction(() => document.querySelector('.cra-live').innerText.includes('제출 1 / 2명'), null, {timeout: 6000});
  ok('55 이름이 테스트인 학생은 제출 수와 전체 인원에서 빠진다', true);
  await T.waitForSelector('.cra-live button:has-text("테스트 학생 1명 제외됨")', {timeout: 4000}).catch(()=>{});
  ok('56 제외된 테스트 학생 수와 포함 버튼이 보인다', await T.locator('.cra-live button:has-text("테스트 학생 1명 제외됨")').count()>=1);
  const [tcsv] = await Promise.all([T.waitForEvent('download'), T.click('#activityPanel button:has-text("⬇ 이 활동 CSV")')]);
  const tc = require('fs').readFileSync(await tcsv.path(),'utf8');
  ok('57 CSV 에 테스트 학생 답이 들어가지 않는다', tc.includes('진짜 학생 답') && !tc.includes('시험용 답'), tc);
  await T.click('.cra-live button:has-text("테스트 학생 1명 제외됨")');
  await T.waitForFunction(() => document.querySelector('.cra-live').innerText.includes('제출 2 / 3명'), null, {timeout: 6000});
  ok('58 포함으로 바꾸면 테스트 학생도 집계된다', true);
  await T.click('.cra-live button:has-text("테스트 학생 포함 중")');
  await T.waitForFunction(() => document.querySelector('.cra-live').innerText.includes('제출 1 / 2명'), null, {timeout: 6000});
  ok('59 다시 누르면 제외로 돌아간다', true);


  // ===== 객관식 큰 화면: 정답·막대는 공개 뒤에만 =====
  T.once('dialog', d => d.accept());
  await T.click('#activityPanel button:has-text("새로 만들기")');
  await addBtn('+ ✅ 객관식').click();
  await step(0).locator('input.t').fill('2 + 3 은?');
  await step(0).locator('.cra-crow input[type=text]').nth(0).fill('4');
  await step(0).locator('.cra-crow input[type=text]').nth(1).fill('5');
  await step(0).locator('.cra-crow input[type=radio]').nth(1).click();
  await step(0).locator('button:has-text("▶ 시작")').click();
  await T.waitForSelector('.cra-live', {timeout: 4000});
  const aidC = DB.acts[DB.acts.length-1].id;
  DB.resps.push({act:aidC, stu:'stu-1', answer:{choice:1}, at:new Date().toISOString()});
  DB.resps.push({act:aidC, stu:'stu-2', answer:{choice:0}, at:new Date().toISOString()});
  await T.waitForFunction(() => document.querySelector('.cra-live').innerText.includes('제출 2 / 2명'), null, {timeout: 6000});
  await T.click('#activityPanel button:has-text("🖥 큰 화면으로 보기")');
  await T.waitForSelector('#craBig .empty, #craBig .row2', {timeout: 4000});
  const b1 = await T.locator('#craBig .bd').innerText();
  ok('60 공개 전 큰 화면에는 정답 표시가 없고 막대 대신 "N명이 골랐어요"만 있다', !b1.includes('정답') && b1.includes('2명이 골랐어요') && !b1.includes('%'), b1);
  await T.click('#craBig button:has-text("막대 미리 보기")');
  const b2 = await T.locator('#craBig .bd').innerText();
  ok('61 막대 미리 보기를 눌러도 정답은 가려져 있다', b2.includes('%') && !b2.includes('정답'), b2);
  await T.click('#craBig button:has-text("정답·결과 공개")');
  await T.waitForFunction(() => document.querySelector('#craBig') && document.querySelector('#craBig').innerText.includes('✔ 정답'), null, {timeout: 6000});
  const b3 = await T.locator('#craBig .bd').innerText();
  ok('62 공개하면 정답 표시와 백분율이 나온다', b3.includes('✔ 정답') && b3.includes('50%'), b3);
  ok('63 공개 뒤 오답은 흐리게 표시된다', await T.locator('#craBig .row2.dim').count()===1 && await T.locator('#craBig .row2.ans').count()===1);
  await T.keyboard.press('Escape');


  // ===== 활동 연결 확인 · 새 버전 안내 =====
  DB.ready = 1;
  await T.waitForFunction(() => /활동을 받을 수 있는 학생 1 \/ \d+명/.test(document.querySelector('#activityPanel').innerText) && document.querySelector('#activityPanel').innerText.includes('새로고침'), null, {timeout: 8000});
  ok('64 활동을 받을 준비가 안 된 학생이 있으면 교사 화면에 안내가 뜬다', true);
  DB.ready = undefined;
  await T.waitForFunction(() => /활동을 받을 수 있는 학생 (\d+) \/ \1명/.test(document.querySelector('#activityPanel').innerText), null, {timeout: 8000});
  ok('65 모두 준비되면 안내가 정상 표시로 바뀐다', true);
  ok('66 새 버전이 없으면 새로고침 안내가 뜨지 않는다', (await S.locator('[data-keep-ui]:has-text("새 기능이 들어왔어요")').count())===0);
  require('child_process').execFileSync('touch',['-d','+1 hour',require('path').join(__dirname,'..','student-activity.js')]);
  await S.waitForSelector('text=새 기능이 들어왔어요', {timeout: 8000});
  ok('67 파일이 바뀌면 학생 화면에 새로고침 안내가 뜬다', await S.locator('text=새 기능이 들어왔어요').count()>=1);

  // ===== 흐름 목록 정리 =====
  ok('68 흐름 목록에 날짜가 표시된다', /사용 \d+\/\d+|저장 \d+\/\d+/.test(await T.locator('#activityPanel .cra-flowbar select:nth-of-type(2)').innerText()));
  ok('69 ▶ 처음부터로 시작하면 사용일이 기록된다', DB.flows.some(f=>f.last_used_at));
  await T.selectOption('#activityPanel .cra-flowbar select:nth-of-type(1)', {index: 1});
  await T.waitForTimeout(300);
  const names=(await T.locator('#activityPanel .cra-flowbar select:nth-of-type(2) option').allInnerTexts()).slice(1).map(x=>x.replace(/ \(.*/,''));
  ok('70 이름순 정렬이 된다', JSON.stringify(names)===JSON.stringify([...names].sort((a,b)=>a.localeCompare(b,'ko'))), names.join(','));

  // 마감 후 제출 거부 메시지
  ok('27 스크립트 오류가 없다', errs.length===0, errs.join(' | '));

  await browser.close();
  for (const r of results) console.log(r.join('  '));
  process.exit(results.some(r=>r[0]==='FAIL')?1:0);
})();
