// Supabase Edge Function: school-tool (접속 현황 · 공지 · 선생님↔학생 메시지 · 구글 로그인 신청/승인)
// 학생 화면 -> (이 함수) -> DB. 입장 방법 두 가지:
//  1) 구글 로그인(Supabase Auth): 화면이 받은 로그인 토큰(jwt)을 이 함수가 Supabase 에 물어 확인한다.
//     처음 보는 계정은 번호를 적어 신청(st_accounts, pending) -> 교사가 승인하면 그 번호로 입장.
//  2) 번호 + 이름(gt_students 명단): ST_ALLOW_NAME_LOGIN=0 으로 끌 수 있다(기본은 켜짐).
// verify_jwt=false 로 배포하고 함수 안에서 방어: 토큰/명단 확인, 잘못된 입력 잠금(IP), Origin 확인, 길이·횟수 제한.
// 비밀값/설정: GT_ALLOW_ORIGIN(쉼표로 여러 주소), GT_MAX_BAD_CODES(기본 60), ST_ALLOW_NAME_LOGIN(기본 1)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MAX_BAD = Number(Deno.env.get("GT_MAX_BAD_CODES") ?? "60");
const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
const ALLOW_NAME_LOGIN = (Deno.env.get("ST_ALLOW_NAME_LOGIN") ?? "1") !== "0";
const MAX_BODY = 300;
const tokenCache = new Map<string, { uid: string; email: string; name: string; exp: number }>();   // 같은 토큰을 60초 동안 다시 묻지 않는다

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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
type Student = { id: string; number: number; class_id: string; name: string };

async function findByNumber(num: number): Promise<Student | null> {
  const { data } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)")
    .eq("number", num).eq("gt_classes.active", true).limit(1);
  return (data?.[0] as Student) ?? null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (!ALLOW_LIST.length) return json({ error: "server_not_configured" }, 500, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  if (!ALLOW_ANY && origin && !ALLOW_LIST.includes(origin)) return json({ error: "forbidden_origin" }, 403, origin);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
  const action = ["hello", "ping", "send", "account", "request", "chat_list", "chat_send"].includes(body.action) ? body.action : "";
  if (!action) return json({ error: "bad_action" }, 400, origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  const since10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: bad } = await sb.from("gt_auth_failures").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since10);
  if ((bad ?? 0) >= MAX_BAD) return json({ error: "too_many_attempts" }, 429, origin);
  const fail = async (err: string, status = 401) => { await sb.from("gt_auth_failures").insert({ ip }); return json({ error: err }, status, origin); };

  // ---------- 로그인 토큰 확인(Supabase Auth, 구글 계정만) ----------
  async function whoIs(jwt: unknown): Promise<{ uid: string; email: string; name: string } | null> {
    if (typeof jwt !== "string" || jwt.length < 20 || jwt.length > 4000) return null;
    const hit = tokenCache.get(jwt);
    if (hit && hit.exp > Date.now()) return hit;
    const { data, error } = await sb.auth.getUser(jwt);
    const u = data?.user;
    if (error || !u || !u.email || !u.email_confirmed_at) return null;
    // deno-lint-ignore no-explicit-any
    if (!(u.identities ?? []).some((i: any) => i.provider === "google")) return null;   // 구글로 확인된 계정만
    // deno-lint-ignore no-explicit-any
    const md = (u.user_metadata ?? {}) as any;
    const v = { uid: u.id, email: u.email.toLowerCase().slice(0, 200), name: String(md.full_name ?? md.name ?? "").slice(0, 100), exp: Date.now() + 60000 };
    if (tokenCache.size > 200) tokenCache.clear();
    tokenCache.set(jwt, v);
    return v;
  }

  // 교사가 미리 등록해 둔 학교 계정(auth_id 비어 있음)은 첫 구글 로그인 때 연결한다
  async function findAcc(g: { uid: string; email: string }) {
    const { data: a } = await sb.from("st_accounts").select("id,status,student_id").eq("auth_id", g.uid).maybeSingle();
    if (a) return a;
    const { data: pre } = await sb.from("st_accounts").select("id,status,student_id").eq("email", g.email).is("auth_id", null).eq("status", "approved").maybeSingle();
    if (!pre) return null;
    const { error } = await sb.from("st_accounts").update({ auth_id: g.uid }).eq("id", pre.id).is("auth_id", null);
    return error ? null : pre;
  }

  if (action === "account" || action === "request") {
    const g = await whoIs(body.jwt);
    if (!g) return fail("bad_login");
    const acc = await findAcc(g);
    if (acc) {
      if (acc.status !== "approved") return json({ ok: true, pending: true }, 200, origin);
      const { data: s } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)").eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
      if (!s) return json({ error: "no_student" }, 403, origin);
      return json({ ok: true, approved: true, number: s.number, name: s.name }, 200, origin);
    }
    if (action === "account") return json({ ok: true, need_request: true, name: g.name }, 200, origin);
    const num = Number(body.number);
    if (body.consent !== true) return json({ error: "consent_required" }, 400, origin);
    if (!Number.isInteger(num) || num < 1 || num > 60) return json({ error: "bad_number" }, 400, origin);
    const st = await findByNumber(num);
    if (!st) return json({ error: "no_student" }, 404, origin);
    const { error } = await sb.from("st_accounts").insert({ auth_id: g.uid, email: g.email, google_name: g.name, student_id: st.id, status: "pending" });
    if (error && error.code !== "23505") return json({ error: "save_failed" }, 500, origin);
    return json({ ok: true, pending: true }, 200, origin);
  }

  // ---------- 학생 확인: 세션 토큰 또는 번호+이름 ----------
  let st: Student | null = null;
  if (typeof body.jwt === "string" && body.jwt) {
    const g = await whoIs(body.jwt);
    if (!g) return json({ error: "session_expired" }, 401, origin);
    const acc = await findAcc(g);
    if (!acc || acc.status !== "approved") return json({ error: "not_approved" }, 403, origin);
    const { data: s } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)").eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
    st = (s as Student) ?? null;
    if (!st) return json({ error: "no_student" }, 403, origin);
  } else {
    if (!ALLOW_NAME_LOGIN) return json({ error: "login_required" }, 401, origin);
    const num = Number(body.number);
    const key = nameKey(body.name);
    if (!Number.isInteger(num) || num < 1 || num > 60 || !key) return json({ error: "not_found" }, 401, origin);
    const { data: found } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)")
      .eq("number", num).eq("name_key", key).eq("gt_classes.active", true).limit(1);
    st = (found?.[0] as Student) ?? null;
    if (!st) return fail("not_found");
  }

  // ---------- 우리 반 이야기방(학생끼리 대화, 교사가 숨기기·삭제·잠금) ----------
  if (action === "chat_list" || action === "chat_send") {
    const { data: setg } = await sb.from("st_chat_settings").select("locked").eq("class_id", st.class_id).maybeSingle();
    const locked = !!setg?.locked;
    if (action === "chat_send") {
      if (locked) return json({ error: "chat_locked" }, 403, origin);
      const text = String(body.body ?? "").replace(/\s+/g, " ").trim().slice(0, 150);
      if (!text) return json({ error: "empty" }, 400, origin);
      if (/https?:|www\.|\.(com|net|kr|io)\b|@|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/i.test(text)) return json({ error: "blocked_content" }, 400, origin);   // 주소·이메일·전화번호는 올릴 수 없다
      const minAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: recent } = await sb.from("st_chat").select("body,created_at").eq("student_id", st.id).gte("created_at", minAgo).order("created_at", { ascending: false }).limit(10);
      if ((recent?.length ?? 0) >= 8) return json({ error: "too_many_messages" }, 429, origin);
      if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 2000) return json({ error: "too_fast" }, 429, origin);
      if (recent?.some((r) => r.body === text)) return json({ error: "duplicate" }, 400, origin);
      const { error } = await sb.from("st_chat").insert({ class_id: st.class_id, student_id: st.id, body: text });
      if (error) return json({ error: "save_failed" }, 500, origin);
      if (Math.random() < 0.05) await sb.from("st_chat").delete().lt("created_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString());
      return json({ ok: true }, 200, origin);
    }
    const { data: rows } = await sb.from("st_chat").select("id,body,created_at,student_id,gt_students(number,name)")
      .eq("class_id", st.class_id).eq("hidden", false).order("created_at", { ascending: false }).limit(60);
    // deno-lint-ignore no-explicit-any
    const list = (rows ?? []).reverse().map((r: any) => ({ id: r.id, body: r.body, at: r.created_at, num: r.gt_students?.number ?? 0, name: r.gt_students?.name ?? "", mine: r.student_id === st!.id }));
    return json({ ok: true, locked, me: st.number, messages: list }, 200, origin);
  }

  if (action === "send") {
    const text = String(body.body ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BODY);
    if (!text) return json({ error: "empty" }, 400, origin);
    const minAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [{ count: c1 }, { count: c2 }] = await Promise.all([
      sb.from("st_messages").select("id", { count: "exact", head: true }).eq("student_id", st.id).eq("direction", "to_teacher").gte("created_at", minAgo),
      sb.from("st_messages").select("id", { count: "exact", head: true }).eq("student_id", st.id).eq("direction", "to_teacher").gte("created_at", dayAgo),
    ]);
    if ((c1 ?? 0) >= 5 || (c2 ?? 0) >= 100) return json({ error: "too_many_messages" }, 429, origin);
    const { error } = await sb.from("st_messages").insert({ class_id: st.class_id, student_id: st.id, direction: "to_teacher", body: text });
    if (error) return json({ error: "save_failed" }, 500, origin);
    return json({ ok: true }, 200, origin);
  }

  // hello / ping: 접속 표시(last_seen 갱신) 후 받은 글 돌려주기
  if (action === "ping") {
    await sb.from("st_presence").upsert({ student_id: st.id, last_seen: new Date().toISOString(), visible: body.visible !== false });
  }
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [{ data: mine }, { data: ann }] = await Promise.all([
    sb.from("st_messages").select("id,direction,body,created_at").eq("student_id", st.id).gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(30),
    sb.from("st_messages").select("id,direction,body,created_at").eq("class_id", st.class_id).eq("direction", "announce").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(10),
  ]);
  const messages = [...(mine ?? []), ...(ann ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return json({ ok: true, number: st.number, name: st.name, now: new Date().toISOString(), messages }, 200, origin);
});
