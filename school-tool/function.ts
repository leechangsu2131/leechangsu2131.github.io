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
const BLOCKED = /https?:|www\.|\.(com|net|kr|io)\b|@|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/i;   // 주소·이메일·전화번호는 올릴 수 없다
const tokenCache = new Map<string, { uid: string; email: string; name: string; teacher: boolean; exp: number }>();   // 같은 토큰을 60초 동안 다시 묻지 않는다

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
  const action = ["hello", "ping", "send", "account", "request", "chat_list", "chat_send", "who_list", "dm_list", "dm_send", "meet_list", "meet_create", "meet_join", "meet_cancel"].includes(body.action) ? body.action : "";
  if (!action) return json({ error: "bad_action" }, 400, origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  const since10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: bad } = await sb.from("gt_auth_failures").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since10);
  if ((bad ?? 0) >= MAX_BAD) return json({ error: "too_many_attempts" }, 429, origin);
  const fail = async (err: string, status = 401) => { await sb.from("gt_auth_failures").insert({ ip }); return json({ error: err }, status, origin); };

  // ---------- 로그인 토큰 확인(Supabase Auth, 구글 계정만) ----------
  async function whoIs(jwt: unknown): Promise<{ uid: string; email: string; name: string; teacher: boolean } | null> {
    if (typeof jwt !== "string" || jwt.length < 20 || jwt.length > 4000) return null;
    const hit = tokenCache.get(jwt);
    if (hit && hit.exp > Date.now()) return hit;
    const { data, error } = await sb.auth.getUser(jwt);
    const u = data?.user;
    if (error || !u || !u.email || !u.email_confirmed_at) return null;
    // 교사 계정(app_metadata.role === 'teacher')은 로그인 방식과 관계없이 교사로 알아본다. 학생은 구글로 확인된 계정만.
    // deno-lint-ignore no-explicit-any
    const teacher = ((u.app_metadata ?? {}) as any).role === "teacher";
    // deno-lint-ignore no-explicit-any
    if (!teacher && !(u.identities ?? []).some((i: any) => i.provider === "google")) return null;
    // deno-lint-ignore no-explicit-any
    const md = (u.user_metadata ?? {}) as any;
    const v = { uid: u.id, email: u.email.toLowerCase().slice(0, 200), name: String(md.full_name ?? md.name ?? "").slice(0, 100), teacher, exp: Date.now() + 60000 };
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
    if (g.teacher) return json({ ok: true, teacher: true }, 200, origin);   // 교사 계정은 학생 신청 대상이 아니다
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
      if (BLOCKED.test(text)) return json({ error: "blocked_content" }, 400, origin);   // 주소·이메일·전화번호는 올릴 수 없다
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

  // ---------- 같이 놀자 / 같이 공부하자 모임판(고르기 중심, 공공장소만, 교사가 숨기기·삭제·잠금) ----------
  if (action.startsWith("meet_")) {
    const PLACES = ["ground", "school_lib", "playground", "town_lib"];                       // 미리 정한 공공장소만(집·주소 없음)
    const ACTS: Record<string, string[]> = { play: ["tag", "ball", "board", "jump", "draw", "talk"], study: ["homework", "read", "math", "write"] };
    const { data: setg } = await sb.from("st_chat_settings").select("meetup_locked").eq("class_id", st.class_id).maybeSingle();
    const locked = !!setg?.meetup_locked;
    const now = new Date();
    if (action === "meet_list") {
      const from = new Date(now.getTime() - 30 * 60 * 1000).toISOString();     // 끝난 지 30분 안 된 모임까지 보여 준다
      const { data: rows } = await sb.from("st_meetups").select("id,host_id,kind,activity,place,until_at,max_people,note,created_at,st_meetup_joins(student_id)")
        .eq("class_id", st.class_id).eq("hidden", false).eq("cancelled", false).gte("until_at", from).order("created_at", { ascending: false }).limit(40);
      const { data: mates } = await sb.from("gt_students").select("id,number,name").eq("class_id", st.class_id);
      const byId = new Map((mates ?? []).map((m: any) => [m.id, m]));
      const list = ((rows ?? []) as any[]).map((r) => {
        const ids: string[] = [r.host_id, ...r.st_meetup_joins.map((j: any) => j.student_id).filter((x: string) => x !== r.host_id)];
        return { id: r.id, kind: r.kind, activity: r.activity, place: r.place, until: r.until_at, max: r.max_people, note: r.note, ended: r.until_at < now.toISOString(),
          host: byId.get(r.host_id)?.name ?? "", mine: r.host_id === st!.id, joined: ids.includes(st!.id),
          people: ids.map((i) => ({ num: byId.get(i)?.number ?? 0, name: byId.get(i)?.name ?? "" })) };
      });
      return json({ ok: true, locked, me: st.number, meetups: list }, 200, origin);
    }
    if (locked) return json({ error: "chat_locked" }, 403, origin);
    if (action === "meet_create") {
      const kind = String(body.kind ?? "");
      const activity = String(body.activity ?? "");
      const place = String(body.place ?? "");
      const mins = Number(body.minutes);
      const max = Number(body.max);
      if (!(kind in ACTS) || !ACTS[kind].includes(activity) || !PLACES.includes(place) || ![30, 60, 90].includes(mins) || !Number.isInteger(max) || max < 2 || max > 8) return json({ error: "bad_input" }, 400, origin);
      const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
      if (note && BLOCKED.test(note)) return json({ error: "blocked_content" }, 400, origin);
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
      const { count: dayN } = await sb.from("st_meetups").select("id", { count: "exact", head: true }).eq("host_id", st.id).gte("created_at", dayAgo);
      if ((dayN ?? 0) >= 5) return json({ error: "too_many_messages" }, 429, origin);
      const { count: open } = await sb.from("st_meetups").select("id", { count: "exact", head: true }).eq("host_id", st.id).eq("cancelled", false).gte("until_at", now.toISOString());
      if ((open ?? 0) >= 2) return json({ error: "too_many_open" }, 429, origin);
      const { error } = await sb.from("st_meetups").insert({ class_id: st.class_id, host_id: st.id, kind, activity, place, until_at: new Date(now.getTime() + mins * 60000).toISOString(), max_people: max, note });
      if (error) return json({ error: "save_failed" }, 500, origin);
      if (Math.random() < 0.05) await sb.from("st_meetups").delete().lt("created_at", new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString());
      return json({ ok: true }, 200, origin);
    }
    const { data: m } = await sb.from("st_meetups").select("id,host_id,class_id,until_at,max_people,hidden,cancelled").eq("id", String(body.id ?? "")).maybeSingle();
    if (!m || m.class_id !== st.class_id || m.hidden || m.cancelled) return json({ error: "no_meetup" }, 404, origin);
    if (action === "meet_cancel") {
      if (m.host_id !== st.id) return json({ error: "forbidden" }, 403, origin);
      await sb.from("st_meetups").update({ cancelled: true }).eq("id", m.id);
      return json({ ok: true }, 200, origin);
    }
    // meet_join: 누르면 참가, 다시 누르면 취소
    if (m.host_id === st.id) return json({ error: "is_host" }, 400, origin);
    const { data: cur } = await sb.from("st_meetup_joins").select("student_id").eq("meetup_id", m.id);
    if (cur?.some((j: any) => j.student_id === st!.id)) {
      await sb.from("st_meetup_joins").delete().eq("meetup_id", m.id).eq("student_id", st.id);
      return json({ ok: true, joined: false }, 200, origin);
    }
    if (m.until_at < now.toISOString()) return json({ error: "ended" }, 400, origin);
    if ((cur?.length ?? 0) + 1 >= m.max_people) return json({ error: "full" }, 400, origin);     // 만든 사람 1명 포함
    const { error } = await sb.from("st_meetup_joins").insert({ meetup_id: m.id, student_id: st.id });
    if (error) return json({ error: "save_failed" }, 500, origin);
    return json({ ok: true, joined: true }, 200, origin);
  }

  // ---------- 접속 중인 친구 · 1:1 메시지(교사가 모두 볼 수 있음) ----------
  if (action === "who_list" || action === "dm_list" || action === "dm_send") {
    const { data: mates } = await sb.from("gt_students").select("id,number,name").eq("class_id", st.class_id).order("number", { ascending: true });
    const byId = new Map((mates ?? []).map((m: any) => [m.id, m]));
    if (action === "who_list") {
      const since = new Date(Date.now() - 75 * 1000).toISOString();
      const { data: pr } = await sb.from("st_presence").select("student_id,last_seen,visible,where_path,hide_status").in("student_id", (mates ?? []).map((m: any) => m.id));
      const pm = new Map((pr ?? []).map((r: any) => [r.student_id, r]));
      const friends = (mates ?? []).map((m: any) => {
        const r: any = pm.get(m.id);
        const mine = m.id === st!.id;
        const shown = !!r && r.last_seen >= since && (!r.hide_status || mine);
        return { num: m.number, name: m.name, mine, online: shown, active: shown && r.visible !== false, where: shown && !r.hide_status ? (r.where_path ?? "") : "" };
      });
      return json({ ok: true, me: st.number, friends }, 200, origin);
    }
    const { data: setg } = await sb.from("st_chat_settings").select("dm_locked").eq("class_id", st.class_id).maybeSingle();
    const locked = !!setg?.dm_locked;
    if (action === "dm_list") {
      const withNum = body.with === undefined || body.with === null ? null : Number(body.with);
      if (withNum === null) {
        const { data: rows } = await sb.from("st_dm").select("id,from_id,to_id,body,read_at,created_at").eq("hidden", false)
          .or(`from_id.eq.${st.id},to_id.eq.${st.id}`).order("created_at", { ascending: false }).limit(200);
        const peers = new Map<string, any>();
        for (const r of (rows ?? []) as any[]) {
          const pid = r.from_id === st.id ? r.to_id : r.from_id;
          const m: any = byId.get(pid); if (!m) continue;
          const p = peers.get(pid) ?? { num: m.number, name: m.name, last: r.body, at: r.created_at, unread: 0 };
          if (r.to_id === st.id && !r.read_at) p.unread++;
          peers.set(pid, p);
        }
        const list = [...peers.values()];
        return json({ ok: true, locked, unread: list.reduce((a, p) => a + p.unread, 0), peers: list }, 200, origin);
      }
      const peer: any = (mates ?? []).find((m: any) => m.number === withNum);
      if (!peer || peer.id === st.id) return json({ error: "no_student" }, 404, origin);
      const { data: rows } = await sb.from("st_dm").select("id,from_id,body,created_at").eq("hidden", false)
        .or(`and(from_id.eq.${st.id},to_id.eq.${peer.id}),and(from_id.eq.${peer.id},to_id.eq.${st.id})`).order("created_at", { ascending: false }).limit(60);
      await sb.from("st_dm").update({ read_at: new Date().toISOString() }).eq("to_id", st.id).eq("from_id", peer.id).is("read_at", null);
      const list = ((rows ?? []) as any[]).reverse().map((r) => ({ id: r.id, body: r.body, at: r.created_at, mine: r.from_id === st!.id }));
      return json({ ok: true, locked, peer: { num: peer.number, name: peer.name }, messages: list }, 200, origin);
    }
    // dm_send
    if (locked) return json({ error: "chat_locked" }, 403, origin);
    const peer: any = (mates ?? []).find((m: any) => m.number === Number(body.to));
    if (!peer || peer.id === st.id) return json({ error: "no_student" }, 404, origin);
    const text = String(body.body ?? "").replace(/\s+/g, " ").trim().slice(0, 150);
    if (!text) return json({ error: "empty" }, 400, origin);
    if (BLOCKED.test(text)) return json({ error: "blocked_content" }, 400, origin);
    const minAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [{ data: recent }, { count: dayN }] = await Promise.all([
      sb.from("st_dm").select("body,created_at").eq("from_id", st.id).gte("created_at", minAgo).order("created_at", { ascending: false }).limit(10),
      sb.from("st_dm").select("id", { count: "exact", head: true }).eq("from_id", st.id).gte("created_at", dayAgo),
    ]);
    if ((recent?.length ?? 0) >= 8 || (dayN ?? 0) >= 150) return json({ error: "too_many_messages" }, 429, origin);
    if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < 2000) return json({ error: "too_fast" }, 429, origin);
    if (recent?.some((r: any) => r.body === text)) return json({ error: "duplicate" }, 400, origin);
    const { error } = await sb.from("st_dm").insert({ class_id: st.class_id, from_id: st.id, to_id: peer.id, body: text });
    if (error) return json({ error: "save_failed" }, 500, origin);
    if (Math.random() < 0.05) await sb.from("st_dm").delete().lt("created_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString());
    return json({ ok: true }, 200, origin);
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
    const wp = String(body.where ?? "").slice(0, 80);
    await sb.from("st_presence").upsert({ student_id: st.id, last_seen: new Date().toISOString(), visible: body.visible !== false, where_path: /^[A-Za-z0-9_.\/%-]*$/.test(wp) ? wp : "", hide_status: body.hide === true });
  }
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [{ data: mine }, { data: ann }] = await Promise.all([
    sb.from("st_messages").select("id,direction,body,created_at").eq("student_id", st.id).gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(30),
    sb.from("st_messages").select("id,direction,body,created_at").eq("class_id", st.class_id).eq("direction", "announce").gte("created_at", weekAgo).order("created_at", { ascending: false }).limit(10),
  ]);
  const messages = [...(mine ?? []), ...(ann ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const { count: dmUnread } = await sb.from("st_dm").select("id", { count: "exact", head: true }).eq("to_id", st.id).eq("hidden", false).is("read_at", null);
  return json({ ok: true, number: st.number, name: st.name, now: new Date().toISOString(), messages, dm_unread: dmUnread ?? 0 }, 200, origin);
});
