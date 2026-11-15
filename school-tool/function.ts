// Supabase Edge Function: school-tool (접속 현황 · 공지 · 선생님↔학생 메시지 · 구글 로그인 신청/승인)
// 학생 화면 -> (이 함수) -> DB. 입장 방법 두 가지:
//  1) 구글 로그인: 구글이 준 신분 확인 값(ID 토큰)을 이 함수가 직접 검증한다. Supabase Auth 는 쓰지 않는다
//     (공용 프로젝트의 다른 앱에 학생 계정이 생기지 않게 하려고).
//     처음 보는 계정은 번호를 적어 신청 -> 교사가 승인하면 그 번호로 입장. 승인 후에는 이 함수가 만든 세션 토큰을 쓴다.
//  2) 번호 + 이름(gt_students 명단): ST_ALLOW_NAME_LOGIN=0 으로 끌 수 있다(기본은 켜짐).
// verify_jwt=false 로 배포하고 함수 안에서 방어: 신분 검증, 명단 확인, 잘못된 입력 잠금(IP), Origin 확인, 길이·횟수 제한.
// 비밀값/설정: GT_ALLOW_ORIGIN(쉼표로 여러 주소), GT_MAX_BAD_CODES(기본 60), ST_GOOGLE_CLIENT_ID, ST_ALLOW_NAME_LOGIN(기본 1)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MAX_BAD = Number(Deno.env.get("GT_MAX_BAD_CODES") ?? "60");
const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
const GOOGLE_CLIENT_ID = Deno.env.get("ST_GOOGLE_CLIENT_ID") ?? "";   // 아래 배포 시 채움
const ALLOW_NAME_LOGIN = (Deno.env.get("ST_ALLOW_NAME_LOGIN") ?? "1") !== "0";
const MAX_BODY = 300;
const SESSION_DAYS = 14;
let jwks: unknown = null;   // jose 는 구글 로그인 때만 불러온다(불러오기 실패가 번호+이름 입장을 막지 않게)

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
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken(): string {
  const a = crypto.getRandomValues(new Uint8Array(32));
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Student = { id: string; number: number; class_id: string };

async function findByNumber(num: number): Promise<Student | null> {
  const { data } = await sb.from("gt_students").select("id,number,class_id,gt_classes!inner(active)")
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
  const action = ["hello", "ping", "send", "google_login", "google_request", "logout"].includes(body.action) ? body.action : "";
  if (!action) return json({ error: "bad_action" }, 400, origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  const since10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: bad } = await sb.from("gt_auth_failures").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since10);
  if ((bad ?? 0) >= MAX_BAD) return json({ error: "too_many_attempts" }, 429, origin);
  const fail = async (err: string, status = 401) => { await sb.from("gt_auth_failures").insert({ ip }); return json({ error: err }, status, origin); };

  // ---------- 구글 신분 확인 ----------
  async function verifyGoogle(credential: unknown): Promise<{ email: string; name: string } | null> {
    if (!GOOGLE_CLIENT_ID || typeof credential !== "string" || credential.length < 20 || credential.length > 4000) return null;
    try {
      const jose = await import("https://esm.sh/jose@5.9.6");
      if (!jwks) jwks = jose.createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
      // deno-lint-ignore no-explicit-any
      const { payload } = await jose.jwtVerify(credential, jwks as any, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: GOOGLE_CLIENT_ID });
      if (payload.email_verified !== true || typeof payload.email !== "string") return null;
      return { email: payload.email.toLowerCase().slice(0, 200), name: String(payload.name ?? "").slice(0, 100) };
    } catch { return null; }
  }
  async function makeSession(accountId: string): Promise<string> {
    const token = newToken();
    await sb.from("st_sessions").insert({ token_hash: await sha256hex(token), account_id: accountId, expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() });
    return token;
  }

  if (action === "google_login" || action === "google_request") {
    if (!GOOGLE_CLIENT_ID) return json({ error: "google_not_configured" }, 503, origin);
    const g = await verifyGoogle(body.credential);
    if (!g) return fail("bad_google");
    const { data: acc } = await sb.from("st_accounts").select("id,status,student_id").eq("email", g.email).maybeSingle();
    if (acc) {
      if (acc.status !== "approved") return json({ ok: true, pending: true }, 200, origin);
      const { data: s } = await sb.from("gt_students").select("id,number,class_id,gt_classes!inner(active)").eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
      if (!s) return json({ error: "no_student" }, 403, origin);
      return json({ ok: true, session: await makeSession(acc.id), number: s.number }, 200, origin);
    }
    if (action === "google_login") return json({ ok: true, need_request: true, name: g.name }, 200, origin);
    // 신청: 번호 + 동의가 있어야 한다
    const num = Number(body.number);
    if (body.consent !== true) return json({ error: "consent_required" }, 400, origin);
    if (!Number.isInteger(num) || num < 1 || num > 60) return json({ error: "bad_number" }, 400, origin);
    const st = await findByNumber(num);
    if (!st) return json({ error: "no_student" }, 404, origin);
    const { error } = await sb.from("st_accounts").insert({ email: g.email, google_name: g.name, student_id: st.id, status: "pending" });
    if (error && error.code !== "23505") return json({ error: "save_failed" }, 500, origin);
    return json({ ok: true, pending: true }, 200, origin);
  }

  if (action === "logout") {
    if (typeof body.session === "string" && body.session.length === 64) await sb.from("st_sessions").delete().eq("token_hash", await sha256hex(body.session));
    return json({ ok: true }, 200, origin);
  }

  // ---------- 학생 확인: 세션 토큰 또는 번호+이름 ----------
  let st: Student | null = null;
  if (typeof body.session === "string" && body.session.length === 64) {
    const { data: ss } = await sb.from("st_sessions").select("account_id,expires_at,st_accounts!inner(status,student_id)").eq("token_hash", await sha256hex(body.session)).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const a = (ss as any)?.st_accounts;
    if (ss && new Date(ss.expires_at) > new Date() && a?.status === "approved") {
      const { data: s } = await sb.from("gt_students").select("id,number,class_id,gt_classes!inner(active)").eq("id", a.student_id).eq("gt_classes.active", true).maybeSingle();
      st = (s as Student) ?? null;
    }
    if (!st) return json({ error: "session_expired" }, 401, origin);
  } else {
    if (!ALLOW_NAME_LOGIN) return json({ error: "login_required" }, 401, origin);
    const num = Number(body.number);
    const key = nameKey(body.name);
    if (!Number.isInteger(num) || num < 1 || num > 60 || !key) return json({ error: "not_found" }, 401, origin);
    const { data: found } = await sb.from("gt_students").select("id,number,class_id,gt_classes!inner(active)")
      .eq("number", num).eq("name_key", key).eq("gt_classes.active", true).limit(1);
    st = (found?.[0] as Student) ?? null;
    if (!st) return fail("not_found");
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
  return json({ ok: true, number: st.number, now: new Date().toISOString(), messages }, 200, origin);
});
