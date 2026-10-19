"""가상 학생이 모든 문항을 풀어 제출 → 학생 화면(미응답 경고, 제출, 백업 파일, 서버 전송 본문)을 Playwright로 검증.
사용: python3 build.py && python3 e2e_check.py
네트워크 요청(rest/v1)은 가짜 응답으로 가로채므로 실제 DB에는 아무것도 저장되지 않는다.
"""
import json, glob, copy, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'e2e_out'; OUT.mkdir(exist_ok=True)
tests = {json.loads(p.read_text())['id']: json.loads(p.read_text()) for p in (ROOT/'tests').glob('*.json')}
errs = []
captured = {'student': [], 'cm': []}
def handle(route, request):
    if request.method == 'POST':
        body = request.post_data or ''
        (captured['cm'] if 'class-manage' in request.url else captured['student']).append(json.loads(body))
        route.fulfill(status=201, body='')
    else:
        route.fulfill(status=200, body='[]')


def solve(pg, q):
    n, t = q['no'], q['type']
    if t == 'choice':
        for i in q['answer']: pg.click(f'[data-act=opt][data-q="{n}"][data-i="{i}"]')
    elif t == 'ox':
        for i, v in enumerate(q['answer']):
            if v: pg.click(f'[data-act=ox][data-q="{n}"][data-i="{i}"]')
        if not any(q['answer']): pass
    elif t == 'short':
        for i, p in enumerate(q['parts']): pg.fill(f'[data-in=short][data-q="{n}"][data-i="{i}"]', p['answer'])
    elif t == 'symbol':
        pg.click(f'[data-act=sym][data-q="{n}"][data-v="{q["answer"]}"]')
    elif t == 'match':
        for l, r in q['answer']:
            pg.click(f'[data-act=mL][data-q="{n}"][data-i="{l}"]'); pg.click(f'[data-act=mR][data-q="{n}"][data-i="{r}"]')
    elif t == 'written':
        for i in range(q['inputs']): pg.fill(f'[data-in=written][data-q="{n}"][data-i="{i}"]', f'테스트 답 {i+1}')
    elif t == 'work':
        pg.fill(f'[data-in=work][data-f=process][data-q="{n}"]', '48÷3=16')
        if q.get('choices'): pg.click(f'[data-act=wch][data-q="{n}"][data-v="{q["answer"]}"]')
        else: pg.fill(f'[data-in=work][data-f=answer][data-q="{n}"]', q['answer'])

with sync_playwright() as p:
    b = p.chromium.launch()
    files = []
    for tid, T in tests.items():
        ctx = b.new_context(viewport={'width': 820, 'height': 1000}, accept_downloads=True)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e, tid=tid: errs.append((tid, str(e))))
        pg.on('console', lambda m, tid=tid: errs.append((tid, m.text)) if m.type == 'error' else None)
        ctx.route('**/rest/v1/**', handle)
        pg.goto(f'file://{ROOT}/dist/student_{tid}.html')
        # 번호/이름 미입력 검증
        pg.click('#btnStart'); assert pg.is_visible('#startErr')
        pg.fill('#inNo', '7'); pg.fill('#inName', '홍길동'); pg.click('#btnStart')
        # 아직 아무것도 안 풀고 제출 → 경고 문구
        pg.click('#btnSubmit'); txt = pg.inner_text('#ovMsg'); assert '안 푼 문제' in txt, txt; pg.click('#ovNo')
        for q in T['questions']: solve(pg, q)
        assert pg.inner_text('#progTxt') == f"{len(T['questions'])} / {len(T['questions'])}", pg.inner_text('#progTxt')
        pg.screenshot(path=str(OUT/f'{tid}_quiz.png'), full_page=True)
        pg.click('#btnSubmit'); assert '모두 풀었어요' in pg.inner_text('#ovMsg')
        with pg.expect_download() as dl: pg.click('#ovYes')
        f = OUT/f'{tid}_sub.json'; dl.value.save_as(str(f)); files.append(f)
        pg.wait_for_selector('#sendTxt'); pg.screenshot(path=str(OUT/f'{tid}_done.png'))
        print(tid, 'submit OK ->', json.loads(f.read_text())['answers'].keys().__len__(), '문항', '| 전송상태:', pg.inner_text('#sendTxt'))
        ctx.close()

    # 모바일 폭 확인
    ctx = b.new_context(viewport={'width': 390, 'height': 800}, is_mobile=True, has_touch=True); pg = ctx.new_page()
    pg.goto(f'file://{ROOT}/dist/student_math-3-2-2-basic1.html'); pg.fill('#inNo', '3'); pg.fill('#inName', '모바일'); pg.click('#btnStart')
    for q in tests['math-3-2-2-basic1']['questions']:
        if q['type'] == 'match': solve(pg, q)
    pg.locator('#q13').scroll_into_view_if_needed(); pg.locator('#q13').screenshot(path=str(OUT/'mobile_q13.png'))
    pg.locator('#q6').screenshot(path=str(OUT/'mobile_q6.png'))
    ctx.close()

    b.close()
print('학생 전송 본문 키:', [sorted(x.keys()) for x in captured['student']][:1], '건수', len(captured['student']))
(OUT/'student_payload.json').write_text(json.dumps(captured['student'][0], ensure_ascii=False))
print('JS 오류:', errs)
