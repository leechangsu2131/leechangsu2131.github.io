#!/usr/bin/env python3
"""단원평가 HTML 빌드 (학생용 + 문항 기준표 SQL).

tests/*.json (문항+정답)  ->  dist/student_<id>.html   (정답 없음, 이미지 포함 단일 파일)
                              dist/unit_test_items.sql (문항별 평가 요소·정답·채점 기준 upsert)
사용: python3 build.py            (config.json 의 Supabase 설정을 넣어서 빌드)
      python3 build.py --review   (Supabase 설정 없이 학생용 확인 페이지만 dist_review/ 에)
채점·기록은 별도 프로그램이 Supabase 의 unit_test_items 를 읽어 처리하고 unit_test_item_results 에 쓴다.
"""
import base64, json, mimetypes, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REVIEW = "--review" in sys.argv   # 시험지 확인용: Supabase 설정 없이 학생용 페이지만 만든다
DIST = ROOT / ("dist_review" if REVIEW else "dist")
DIST.mkdir(exist_ok=True)

cfg_path = ROOT / "config.json"
CFG = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
CFG.setdefault("supabaseUrl", "")
CFG.setdefault("supabaseAnonKey", "")
CFG.setdefault("table", "unit_test_submissions")
CFG.setdefault("classLabel", "")
if REVIEW:
    CFG["supabaseUrl"] = CFG["supabaseAnonKey"] = ""

SECRET_Q = {"answer", "rubric", "sample", "scoreSteps", "partial", "processPts", "answerPts", "topic", "page", "level"}
SECRET_PART = {"answer", "pts"}


def js(obj):
    # </script> 방지
    return json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")


def data_uri(name):
    p = ROOT / "assets" / name
    mime = mimetypes.guess_type(p.name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def student_view(test):
    t = {k: v for k, v in test.items() if k != "questions"}
    qs = []
    for q in test["questions"]:
        s = {k: v for k, v in q.items() if k not in SECRET_Q}
        if "parts" in s:
            s["parts"] = [{k: v for k, v in p.items() if k not in SECRET_PART} for p in s["parts"]]
        if s.get("image"):
            s["image"] = data_uri(s["image"])
        qs.append(s)
    t["questions"] = qs
    return t


def teacher_view(test):
    t = dict(test)
    t["questions"] = [{k: v for k, v in q.items() if k != "image"} for q in test["questions"]]
    return t


def validate(test):
    errs = []
    total = sum(q["points"] for q in test["questions"])
    if total != 100:
        errs.append(f"배점 합계가 {total}점입니다(100점 아님)")
    for q in test["questions"]:
        if q["type"] == "short":
            per = [p.get("pts") for p in q["parts"]]
            if q.get("partial") and sum(per) != q["points"]:
                errs.append(f"{q['no']}번 부분점수 합이 배점과 다름")
        if q["type"] == "work" and q["processPts"] + q["answerPts"] != q["points"]:
            errs.append(f"{q['no']}번 풀이+답 점수 합이 배점과 다름")
    return errs


tests = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((ROOT / "tests").glob("*.json"))]
bad = False
for t in tests:
    for e in validate(t):
        print(f"[경고] {t['id']}: {e}")
        bad = True

tpl_s = (ROOT / "templates" / "student.html").read_text(encoding="utf-8")
cfg_js = js(CFG)

for t in tests:
    html = (tpl_s.replace("/*__TEST__*/null", js(student_view(t)))
                 .replace("/*__CONFIG__*/null", cfg_js)
                 .replace("__TITLE__", f"{t['subject']} {t['title']} 단원평가"))
    out = DIST / f"student_{t['id']}.html"
    out.write_text(html, encoding="utf-8")
    print("만듦:", out.name, f"{out.stat().st_size//1024}KB")

if REVIEW:
    sys.exit(1 if bad else 0)


def lit(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


GRADING_KEYS = ("parts", "partial", "processPts", "answerPts", "scoreSteps", "rubric", "sample", "pick", "unit")
rows = []
for t in tests:
    for q in t["questions"]:
        grading = {k: q[k] for k in GRADING_KEYS if k in q}
        ans = json.dumps(q["answer"], ensure_ascii=False) if "answer" in q else None
        rows.append("(%s,%d,%s,%s,%s,%s,%d,%s::jsonb,%s::jsonb)" % (
            lit(t["id"]), q["no"], lit(q["type"]), lit(q.get("topic")), lit(q.get("page")), lit(q.get("level")),
            q["points"], lit(ans), lit(json.dumps(grading, ensure_ascii=False))))
sql = ("insert into public.unit_test_items (test_id,no,type,topic,page,level,points,answer,grading) values\n"
       + ",\n".join(rows)
       + "\non conflict (test_id,no) do update set type=excluded.type, topic=excluded.topic, page=excluded.page,"
         " level=excluded.level, points=excluded.points, answer=excluded.answer, grading=excluded.grading;\n")
(DIST / "unit_test_items.sql").write_text(sql, encoding="utf-8")
print("만듦: unit_test_items.sql", f"{len(rows)}문항")
sys.exit(1 if bad else 0)
