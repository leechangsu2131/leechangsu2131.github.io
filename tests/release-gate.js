/* 단원평가 배포 단계 확인 (학생 화면용)
 *
 * 교사 화면(classroom/teacher.html)에서 정한 배포 단계를 읽어 학생 화면을 열거나 잠급니다.
 *   미배포                  : 시험지·오답노트·점수 모두 잠금
 *   시험 배포(오답노트 미배포): 시험지만 열림
 *   완전 배포               : 시험지·오답노트·점수 모두 열림
 *
 * 사용법 (페이지 <head> 맨 위, 동기 스크립트):
 *   <script src="release-gate.js" data-test="math-3-2-4-basic4" data-role="exam" data-default="hidden"></script>
 *   data-role : exam(시험지) | notebook(오답노트·점수) | hub(목록 화면)
 *   data-default : 상태를 확인하지 못했을 때의 기본값. 아직 시험 전인 단원은 hidden으로 둡니다. (생략하면 열림)
 *
 * 주의: 이 잠금은 화면을 막는 장치입니다. 시험 문항 파일 자체는 공개 저장소에 있으므로
 *       문항 유출까지 막으려면 시험 당일까지 해당 파일을 저장소에 올리지 않아야 합니다.
 *       오답노트의 개인별 조회는 DB가 따로 막고 있습니다(unit_test_release.released).
 */
(function () {
  var S = document.currentScript;
  var U = 'https://erzdvlcbjneabxqwnwfy.supabase.co';
  var K = 'sb_publishable_29w26VjvhHwI5O6iKOXTwA_sSTKUhfz';
  var role = S.getAttribute('data-role') || 'exam';
  var test = S.getAttribute('data-test') || '';
  var dflt = S.getAttribute('data-default') || 'full'; // hidden | exam | full

  function stageOf(row) {
    if (!row) return dflt;
    if (row.released) return 'full';
    return row.exam_open === false ? 'hidden' : 'exam';
  }
  function allowed(stage, r) {
    if (r === 'exam') return stage === 'exam' || stage === 'full';
    return stage === 'full'; // notebook(오답노트·점수)
  }

  function fetchStatus() {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 4000) : 0;
    return fetch(U + '/rest/v1/rpc/unit_test_release_status', {
      method: 'POST',
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    });
  }

  if (role === 'hub') {
    function markHub(rows) {
      var by = {};
      (rows || []).forEach(function (x) { by[x.test_id] = x; });
      [].forEach.call(document.querySelectorAll('a.card[href]'), function (a) {
        var m = /^(student|notebook|score)_(.+)\.html$/.exec(a.getAttribute('href'));
        if (!m) return;
        var stage = stageOf(by[m[2]]);
        if (allowed(stage, m[1] === 'student' ? 'exam' : 'notebook')) return;
        a.style.opacity = '.55';
        a.style.filter = 'grayscale(.6)';
        var f = a.querySelector('.card-footer');
        if (f) f.innerHTML = '<span>🔒 ' + (m[1] === 'student' ? '아직 열리지 않았어요' : '시험 후에 열려요') + '</span>';
        a.addEventListener('click', function (e) {
          e.preventDefault();
          alert(m[1] === 'student' ? '아직 열리지 않은 시험이에요. 선생님이 열어 주실 때까지 기다려 주세요.' : '오답노트와 점수는 선생님이 열어 주시면 볼 수 있어요.');
        });
      });
    }
    var run = function () { fetchStatus().then(markHub).catch(function () {}); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    return;
  }

  // 시험지·오답노트: 확인이 끝나기 전에는 화면을 가립니다.
  var hide = document.createElement('style');
  hide.id = 'rg-hide';
  hide.textContent = 'body{visibility:hidden!important}';
  document.head.appendChild(hide);

  function open() { if (hide.parentNode) hide.parentNode.removeChild(hide); }
  function lock(stage) {
    var isExam = role === 'exam';
    var title = isExam ? '아직 열리지 않은 시험이에요' : '아직 열리지 않았어요';
    var body = isExam
      ? '선생님이 시험을 열어 주시면 풀 수 있어요.'
      : (stage === 'hidden' ? '시험을 본 뒤에 선생님이 열어 주시면 볼 수 있어요.' : '선생님이 오답노트와 점수를 열어 주시면 볼 수 있어요.');
    hide.textContent = 'body{display:none!important}';
    var box = document.createElement('div');
    box.setAttribute('style', 'position:fixed;inset:0;display:grid;place-items:center;background:#f4f7fb;font-family:system-ui,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#1e293b;padding:24px;text-align:center;z-index:2147483647');
    box.innerHTML = '<div><div style="font-size:54px">🔒</div><h1 style="margin:10px 0 6px;font-size:22px"></h1><p style="margin:0 0 18px;color:#64748b"></p><a href="index.html" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#3b82f6;color:#fff;text-decoration:none;font-weight:700">단원평가 목록으로</a></div>';
    box.querySelector('h1').textContent = title;
    box.querySelector('p').textContent = body;
    document.documentElement.appendChild(box);
  }

  function decide(stage) { if (allowed(stage, role)) open(); else lock(stage); }

  fetchStatus().then(function (rows) {
    var row = null;
    (rows || []).forEach(function (x) { if (x.test_id === test) row = x; });
    decide(stageOf(row));
  }).catch(function () { decide(dflt); });
})();
