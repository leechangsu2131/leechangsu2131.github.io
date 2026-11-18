// Supabase Edge Function: game-board (학생 확인 · 게임 점수 기록 · 순위표 읽기)
// 게임·연습 페이지가 학생 명단을 코드에 넣어 두지 않고, 이 함수에게 물어보게 하려고 만들었다.
// - 명단 목록은 절대 내려주지 않는다. 확인 결과(맞다/아니다)와, 맞을 때의 학생 본인 번호·이름만 준다.
// - 학생 확인 방법(school-tool 과 같은 규칙):
//    1) 구글 로그인 토큰(jwt): 교사가 승인한 계정(st_accounts)만. 번호·이름은 그 계정의 학생 것을 쓴다.
//    2) 번호+이름 직접 입력: gt_students 명단과 맞을 때만. ST_ALLOW_NAME_LOGIN=0 이면 꺼진다(school-tool·growth-tutor 와 같은 스위치).
// - 동작(action)
//    verify     : 번호+이름이 명단과 맞는지만 알려 준다. 맞으면 명단의 이름(공백 정리된 정식 이름)을 준다.
//    board_post : 게임 점수를 class_board_events 에 기록한다. 이름·번호는 서버가 확인한 학생의 것을 쓴다(가짜 이름 불가).
//    board_list : 순위표용 기록을 준다. 로그인한 승인 학생 또는 교사 계정만. 명단과 맞지 않는 줄은 걸러서 준다.
// - verify_jwt=false 로 배포하고 함수 안에서 직접 방어: 토큰/명단 확인, Origin 확인, 입력 검사, 횟수 제한.
// 비밀값: GT_ALLOW_ORIGIN(필수, 쉼표로 여러 주소), ST_ALLOW_NAME_LOGIN(기본 1, 0 이면 직접 입력 확인을 끔)
// 요청 제한: IP 당 10분 600회(학교 한 곳이 같은 IP 를 쓰므로 넉넉하게. 함수 인스턴스 안에서만 세는 대략적인 제한),
//           점수 기록은 학생 한 명당 10분 30회, 한 번에 1~200 XP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
const ALLOW_NAME_LOGIN = (Deno.env.get("ST_ALLOW_NAME_LOGIN") ?? "1") !== "0";
const SRC_OK = new Set(["practice", "battle", "bingo", "soccer", "numline", "pairs"]);
const XP_MAX = 200;
const POSTS_PER_10MIN = 30;
const IP_PER_10MIN = 600;
const BOARD_DAYS = 120;
const BOARD_LIMIT = 5000;

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const tokenCache = new Map<string, { uid: string; email: string; teacher: boolean; google: boolean; exp: number }>();
const hits = new Map<string, number[]>();

function corsHeaders(origin: string | null) {
  const allow = ALLOW_ANY ? "*" : (origin && ALLOW_LIST.includes(origin) ? origin : ALLOW_LIST[0] ?? "");
  return { "Access-Control-Allow-Origin": allow, "Vary": "Origin", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });
}
function nameKey(t: unknown): string {
  return String(t ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase().slice(0, 40);
}
function tooMany(key: string, max: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 2000) hits.clear();
  return arr.length > max;
}

type Student = { id: string; number: number; class_id: string; name: string };

// 로그인 토큰 확인. 학생은 구글 계정만, 교사는 계정의 app_metadata.role === 'teacher' 로 구분한다.
async function whoIs(jwt: unknown) {
  if (typeof jwt !== "string" || jwt.length < 20 || jwt.length > 4000) return null;
  const hit = tokenCache.get(jwt);
  if (hit && hit.exp > Date.now()) return hit;
  const { data, error } = await sb.auth.getUser(jwt);
  const u = data?.user;
  if (error || !u || !u.email || !u.email_confirmed_at) return null;
  // deno-lint-ignore no-explicit-any
  const google = (u.identities ?? []).some((i: any) => i.provider === "google");
  // deno-lint-ignore no-explicit-any
  const teacher = ((u.app_metadata ?? {}) as any).role === "teacher";
  if (!google && !teacher) return null;
  const v = { uid: u.id, email: u.email.toLowerCase().slice(0, 200), teacher, google, exp: Date.now() + 60000 };
  if (tokenCache.size > 200) tokenCache.clear();
  tokenCache.set(jwt, v);
  return v;
}

// 교사가 미리 등록해 둔 학교 계정(auth_id 비어 있음)은 처음 구글 로그인 때 연결한다(school-tool 과 같은 규칙)
async function findAcc(g: { uid: string; email: string }) {
  const { data: a } = await sb.from("st_accounts").select("id,status,student_id").eq("auth_id", g.uid).maybeSingle();
  if (a) return a;
  const { data: pre } = await sb.from("st_accounts").select("id,status,student_id").eq("email", g.email).is("auth_id", null).eq("status", "approved").maybeSingle();
  if (!pre) return null;
  const { error } = await sb.from("st_accounts").update({ auth_id: g.uid }).eq("id", pre.id).is("auth_id", null);
  return error ? null : pre;
}

type Who = { st?: Student; via?: "login" | "typed"; teacher?: boolean; err?: { code: string; status: number } };

// 누구인지 확인한다. jwt 가 있으면 로그인으로, 없으면 번호+이름으로 확인한다.
async function identify(body: any, allowTeacher: boolean): Promise<Who> {
  if (typeof body.jwt === "string" && body.jwt) {
    const g = await whoIs(body.jwt);
    if (!g) return { err: { code: "session_expired", status: 401 } };
    if (g.teacher && allowTeacher) return { teacher: true, via: "login" };
    if (!g.google) return { err: { code: "not_approved", status: 403 } };
    const acc = await findAcc(g);
    if (!acc || acc.status !== "approved") return { err: { code: "not_approved", status: 403 } };
    const { data: s } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)")
      .eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
    if (!s) return { err: { code: "no_student", status: 403 } };
    return { st: s as Student, via: "login" };
  }
  if (!ALLOW_NAME_LOGIN) return { err: { code: "login_required", status: 401 } };
  const num = Number(body.number);
  const key = nameKey(body.name);
  if (!Number.isInteger(num) || num < 1 || num > 60 || !key) return { err: { code: "not_found", status: 200 } };
  const { data: found } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)")
    .eq("number", num).eq("name_key", key).eq("gt_classes.active", true).limit(1);
  const st = (found?.[0] as Student) ?? null;
  if (!st) return { err: { code: "not_found", status: 200 } };
  return { st, via: "typed" };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (!ALLOW_LIST.length) return json({ error: "server_not_configured" }, 500, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  if (!ALLOW_ANY && origin && !ALLOW_LIST.includes(origin)) return json({ error: "forbidden_origin" }, 403, origin);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
  const action = ["verify", "board_post", "board_list"].includes(body.action) ? body.action : "";
  if (!action) return json({ error: "bad_action" }, 400, origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  if (tooMany("ip:" + ip, IP_PER_10MIN)) return json({ error: "too_many_attempts" }, 429, origin);

  // ---------- verify: 맞는지만 알려 준다(명단 목록은 주지 않는다) ----------
  if (action === "verify") {
    const w = await identify(body, false);
    if (w.err) {
      // 직접 입력이 틀린 것은 정상적인 일(오타)이라 오류가 아니라 '맞지 않음'으로 답한다.
      if (w.err.code === "not_found" || w.err.code === "login_required") return json({ ok: true, matched: false, reason: w.err.code }, 200, origin);
      return json({ error: w.err.code }, w.err.status, origin);
    }
    return json({ ok: true, matched: true, via: w.via, number: w.st!.number, name: w.st!.name }, 200, origin);
  }

  // ---------- board_post: 점수 기록(이름·번호는 서버가 확인한 학생의 것) ----------
  if (action === "board_post") {
    const w = await identify(body, false);
    if (w.err) return json({ error: w.err.code === "not_found" ? "not_found" : w.err.code }, w.err.status === 200 ? 401 : w.err.status, origin);
    const st = w.st!;
    const xp = Math.floor(Number(body.xp));
    const src = String(body.src ?? "practice");
    if (!Number.isFinite(xp) || xp < 1) return json({ error: "bad_xp" }, 400, origin);
    if (!SRC_OK.has(src)) return json({ error: "bad_src" }, 400, origin);
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await sb.from("class_board_events").select("id", { count: "exact", head: true }).eq("num", st.number).gte("created_at", since);
    if ((count ?? 0) >= POSTS_PER_10MIN) return json({ error: "too_many_posts" }, 429, origin);
    const { error } = await sb.from("class_board_events").insert({ num: st.number, name: st.name, xp: Math.min(XP_MAX, xp), src });
    if (error) return json({ error: "save_failed" }, 500, origin);
    return json({ ok: true }, 200, origin);
  }

  // ---------- board_list: 순위표 기록(로그인한 승인 학생 또는 교사만) ----------
  if (typeof body.jwt !== "string" || !body.jwt) return json({ error: "login_required" }, 401, origin);
  const w = await identify({ jwt: body.jwt }, true);
  if (w.err) return json({ error: w.err.code }, w.err.status === 200 ? 401 : w.err.status, origin);

  const since = new Date(Date.now() - BOARD_DAYS * 24 * 3600 * 1000).toISOString();
  const [{ data: roster }, { data: events, error: evErr }] = await Promise.all([
    sb.from("gt_students").select("number,name,name_key,gt_classes!inner(active)").eq("gt_classes.active", true),
    sb.from("class_board_events").select("num,name,xp,day").gte("created_at", since).order("id", { ascending: false }).limit(BOARD_LIMIT),
  ]);
  if (evErr) return json({ error: "load_failed" }, 500, origin);
  const keyByNum = new Map<number, string>();
  for (const r of roster ?? []) keyByNum.set(Number(r.number), String(r.name_key ?? nameKey(r.name)));
  // 명단과 번호·이름이 맞는 줄만 준다(이름이 '테스트'·test 로 시작하는 시험용 학생은 순위표에서 뺀다)
  const rows = (events ?? []).filter((e) => keyByNum.get(Number(e.num)) === nameKey(e.name) && !/^(테스트|test)/i.test(String(e.name ?? "").trim())).map((e) => ({ num: e.num, name: e.name, xp: e.xp, day: e.day }));
  return json({ ok: true, teacher: !!w.teacher, me: w.st ? { num: w.st.number, name: w.st.name } : null, rows }, 200, origin);
});
