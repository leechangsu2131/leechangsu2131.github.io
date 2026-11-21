// Supabase Edge Function: char-hub (학생 캐릭터: 조합형으로 만들고 저장, 우리 반 친구들 캐릭터 보기)
// 캐릭터는 그림 파일이 아니라 숫자 조합 코드(몸·색·눈·입·모자·꾸밈)로만 저장한다. 사진·외부 이미지는 받지 않는다.
// - 학생 확인: 구글 로그인(jwt)으로 승인된 학생(st_accounts)만. 번호+이름 입장은 쓸 수 없다(swap-market과 같은 한계).
// - 매너온도 38℃에 한 번 닿으면 특별 모자·꾸밈이 영구 해금된다(st_unlock). 온도 계산은 DB 함수 st_manner 한 곳(최근 28일 칭찬 기준).
// - 교사: t_list(전체 보기) / t_hide(숨기기·되돌리기). 숨긴 캐릭터는 친구들에게 기본 얼굴 대신 빈 칸으로 보인다.
// - verify_jwt=false 로 배포하고 함수 안에서 방어: 로그인 확인, Origin 확인, 입력 검사, 횟수 제한.
// 비밀값: GT_ALLOW_ORIGIN(필수, 쉼표로 여러 주소)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
// 항목별 개수와 특별(온도 38℃ 이상) 번호. 화면(shared/char.js)과 같아야 한다.
const SIZE = { b: 5, c: 10, e: 8, m: 6, h: 10, a: 6 } as const;
const SPECIAL: Record<string, number[]> = { h: [8, 9], a: [5] };
const SPECIAL_TEMP = 38;
// 과목별 레벨: 수학(분수 학습 앱 경험치)·국어(글쓰기 연습 미션 1회 20점). 점수는 DB 함수 st_subject_xp 가 번호+이름으로 묶어 준다.
// 레벨 n 은 누적 점수 50·n·(n-1) 이상(2레벨 100, 3레벨 300, 4레벨 600 …, 최대 20레벨). 레벨·점수는 본인과 교사만 본다.
const SUBJECTS: Record<string, { name: string; emoji: string }> = { math: { name: "수학", emoji: "➗" }, korean: { name: "국어", emoji: "📖" } };
const FOCUS_XP = 10;   // 이번 주 맞춤 도전을 채우면 주는 경험치(주 1회)
function subLevel(xp: number) {
  const lv = Math.max(1, Math.min(20, Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2)));
  return { level: lv, from: 50 * lv * (lv - 1), to: lv >= 20 ? 50 * lv * (lv - 1) : 50 * (lv + 1) * lv };
}
function kstWeekStart(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10);   // 한국 시간 이번 주 월요일
}
// deno-lint-ignore no-explicit-any
function shapeSubjects(r: any) {
  return Object.keys(SUBJECTS).map((id) => { const x = Number(r?.[id]?.xp ?? 0); return { id, ...SUBJECTS[id], xp: x, week: Number(r?.[id]?.week ?? 0), ...subLevel(x) }; });
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const tokenCache = new Map<string, { uid: string; email: string; teacher: boolean; exp: number }>();
const hits = new Map<string, number[]>();

function corsHeaders(origin: string | null) {
  const allow = ALLOW_ANY ? "*" : (origin && ALLOW_LIST.includes(origin) ? origin : ALLOW_LIST[0] ?? "");
  return { "Access-Control-Allow-Origin": allow, "Vary": "Origin", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });
}
function tooMany(key: string, max: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 2000) hits.clear();
  return arr.length > max;
}
type Student = { id: string; number: number; class_id: string; name: string };

async function whoIs(jwt: unknown) {
  if (typeof jwt !== "string" || jwt.length < 20 || jwt.length > 4000) return null;
  const hit = tokenCache.get(jwt);
  if (hit && hit.exp > Date.now()) return hit;
  const { data, error } = await sb.auth.getUser(jwt);
  const u = data?.user;
  if (error || !u || !u.email || !u.email_confirmed_at) return null;
  // deno-lint-ignore no-explicit-any
  const teacher = ((u.app_metadata ?? {}) as any).role === "teacher";
  // deno-lint-ignore no-explicit-any
  const google = (u.identities ?? []).some((i: any) => i.provider === "google");
  if (!teacher && !google) return null;
  const v = { uid: u.id, email: u.email.toLowerCase().slice(0, 200), teacher, exp: Date.now() + 60000 };
  if (tokenCache.size > 200) tokenCache.clear();
  tokenCache.set(jwt, v);
  return v;
}
async function findAcc(g: { uid: string; email: string }) {
  const { data: a } = await sb.from("st_accounts").select("id,status,student_id").eq("auth_id", g.uid).maybeSingle();
  if (a) return a;
  const { data: pre } = await sb.from("st_accounts").select("id,status,student_id").eq("email", g.email).is("auth_id", null).eq("status", "approved").maybeSingle();
  if (!pre) return null;
  const { error } = await sb.from("st_accounts").update({ auth_id: g.uid }).eq("id", pre.id).is("auth_id", null);
  return error ? null : pre;
}
// 조합 코드 검사: 정수이고 범위 안이어야 한다. 이상하면 null.
// deno-lint-ignore no-explicit-any
function cleanParts(p: any): Record<string, number> | null {
  if (!p || typeof p !== "object") return null;
  const out: Record<string, number> = {};
  for (const k of Object.keys(SIZE) as (keyof typeof SIZE)[]) {
    const v = p[k];
    if (!Number.isInteger(v) || v < 0 || v >= SIZE[k]) return null;
    out[k] = v;
  }
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (!ALLOW_LIST.length) return json({ error: "server_not_configured" }, 500, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  if (!ALLOW_ANY && origin && !ALLOW_LIST.includes(origin)) return json({ error: "forbidden_origin" }, 403, origin);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
  const action = ["get", "me", "save", "list", "subjects", "t_list", "t_hide", "t_subjects", "t_focus"].includes(body.action) ? body.action : "";
  if (!action) return json({ error: "bad_action" }, 400, origin);
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  if (tooMany("ip:" + ip, 400)) return json({ error: "too_many_attempts" }, 429, origin);
  const g = await whoIs(body.jwt);
  if (!g) return json({ error: "login_required" }, 401, origin);

  // ---------------- 교사 ----------------
  if (action.startsWith("t_")) {
    if (!g.teacher) return json({ error: "forbidden" }, 403, origin);
    const { data: cls } = await sb.from("gt_classes").select("id").eq("active", true).limit(1);
    const classId = cls?.[0]?.id; if (!classId) return json({ error: "no_class" }, 404, origin);
    const { data: mates } = await sb.from("gt_students").select("id,number,name").eq("class_id", classId).order("number", { ascending: true });
    if (action === "t_hide") {
      const num = Number(body.num);
      // deno-lint-ignore no-explicit-any
      const m = (mates ?? []).find((x: any) => x.number === num);
      if (!m) return json({ error: "no_student" }, 404, origin);
      const { error } = await sb.from("st_char").update({ hidden: body.hidden !== false }).eq("student_id", m.id);
      return error ? json({ error: "save_failed" }, 500, origin) : json({ ok: true }, 200, origin);
    }
    if (action === "t_subjects") {
      const ws = kstWeekStart();
      const { data: fs } = await sb.from("st_focus").select("student_id,subject,target,note").eq("week_start", ws).in("student_id", (mates ?? []).map((m: { id: string }) => m.id));
      // deno-lint-ignore no-explicit-any
      const fby = new Map((fs ?? []).map((f: any) => [f.student_id, f]));
      // deno-lint-ignore no-explicit-any
      const students = await Promise.all((mates ?? []).map(async (m: any) => {
        const { data } = await sb.rpc("st_subject_xp", { p_student: m.id, p_since: ws });
        const f = fby.get(m.id);
        return { num: m.number, name: m.name, subjects: shapeSubjects(data), focus: f ? { subject: f.subject, target: f.target, note: f.note } : null };
      }));
      return json({ ok: true, week_start: ws, subjects: Object.keys(SUBJECTS).map((id) => ({ id, ...SUBJECTS[id] })), students }, 200, origin);
    }
    if (action === "t_focus") {
      const ws = kstWeekStart();
      const items = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
      if (!items.length) return json({ error: "bad_input" }, 400, origin);
      for (const it of items) {
        // deno-lint-ignore no-explicit-any
        const m = (mates ?? []).find((x: any) => x.number === Number(it?.num));
        if (!m) return json({ error: "no_student" }, 404, origin);
        if (it.subject === "none") { await sb.from("st_focus").delete().eq("student_id", m.id).eq("week_start", ws); continue; }
        const target = Math.round(Number(it.target)), note = String(it.note ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        if (!SUBJECTS[it.subject] || !(target >= 10 && target <= 3000) || /https?:|www\.|@|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/i.test(note)) return json({ error: "bad_input" }, 400, origin);
        const { error } = await sb.from("st_focus").upsert({ student_id: m.id, week_start: ws, subject: it.subject, target, note, set_at: new Date().toISOString() }, { onConflict: "student_id,week_start" });
        if (error) return json({ error: "save_failed" }, 500, origin);
      }
      return json({ ok: true }, 200, origin);
    }
    // deno-lint-ignore no-explicit-any
    const { data: rows } = await sb.from("st_char").select("student_id,parts,hidden,updated_at").in("student_id", (mates ?? []).map((m: any) => m.id));
    // deno-lint-ignore no-explicit-any
    const by = new Map((rows ?? []).map((r: any) => [r.student_id, r]));
    // deno-lint-ignore no-explicit-any
    return json({ ok: true, students: (mates ?? []).map((m: any) => ({ num: m.number, name: m.name, parts: by.get(m.id)?.parts ?? null, hidden: !!by.get(m.id)?.hidden, at: by.get(m.id)?.updated_at ?? null })) }, 200, origin);
  }

  // ---------------- 학생 ----------------
  if (g.teacher) return json({ error: "teacher_use_t_actions" }, 403, origin);
  const acc = await findAcc(g);
  if (!acc || acc.status !== "approved") return json({ error: "not_approved" }, 403, origin);
  const { data: s } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)").eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
  const me = (s as Student) ?? null;
  if (!me) return json({ error: "no_student" }, 403, origin);
  if (tooMany("st:" + me.id, 120)) return json({ error: "too_many_attempts" }, 429, origin);

  // 매너온도: 규칙은 DB 함수 st_manner 한 곳(최근 28일·같은 친구 2개까지·올라갈수록 덜 오름·36.5℃ 하한).
  async function myTemp() {
    const { data } = await sb.rpc("st_manner", { p_student: me!.id });
    // deno-lint-ignore no-explicit-any
    const m = (data ?? {}) as any;
    return { temp: Number(m.temp ?? 36.5), count: Number(m.count ?? 0), total: Number(m.total ?? 0) };
  }
  // 경험치·레벨: DB 함수 st_level(누적, 내려가지 않음). 하루 상한·중복 방지는 st_xp_add 가 한다.
  async function myLevel() {
    const { data } = await sb.rpc("st_level", { p_student: me!.id });
    // deno-lint-ignore no-explicit-any
    const m = (data ?? {}) as any;
    return { xp: Number(m.xp ?? 0), level: Number(m.level ?? 1), xp_from: Number(m.from ?? 0), xp_to: Number(m.to ?? 10) };
  }
  // 특별 꾸미기: 한 번 38℃에 닿으면 st_unlock 에 남아 온도가 내려가도 계속 쓴다.
  async function specialOpen(temp: number) {
    const { data: u } = await sb.from("st_unlock").select("key").eq("student_id", me!.id).eq("key", "special_char").maybeSingle();
    if (u) return true;
    if (temp < SPECIAL_TEMP) return false;
    await sb.from("st_unlock").upsert({ student_id: me!.id, key: "special_char" }, { onConflict: "student_id,key", ignoreDuplicates: true });
    return true;
  }

  if (action === "get") {
    const { data: r } = await sb.from("st_char").select("parts,hidden").eq("student_id", me.id).maybeSingle();
    const t = await myTemp();
    return json({ ok: true, me: me.number, mine: r?.parts ?? null, hidden: !!r?.hidden, special_temp: SPECIAL_TEMP, special: SPECIAL, special_open: await specialOpen(t.temp), ...t, ...(await myLevel()) }, 200, origin);
  }

  if (action === "subjects") {
    const ws = kstWeekStart();
    const { data } = await sb.rpc("st_subject_xp", { p_student: me.id, p_since: ws });
    const { data: f } = await sb.from("st_focus").select("subject,target,note").eq("student_id", me.id).eq("week_start", ws).maybeSingle();
    const subjects = shapeSubjects(data);
    let focus = null;
    if (f && SUBJECTS[f.subject]) {
      const wk = subjects.find((x) => x.id === f.subject)?.week ?? 0, done = wk >= f.target;
      if (done) await sb.rpc("st_xp_add", { p_student: me.id, p_kind: "focus", p_ref: ws + ":" + f.subject, p_xp: FOCUS_XP, p_day_cap: 20 });   // 주 1회(중복 방지)
      focus = { subject: f.subject, name: SUBJECTS[f.subject].name, emoji: SUBJECTS[f.subject].emoji, target: f.target, note: f.note, week: wk, done };
    }
    return json({ ok: true, me: me.number, week_start: ws, subjects, focus, ...(await myLevel()) }, 200, origin);
  }

  if (action === "me") return json({ ok: true, me: me.number, ...(await myTemp()), ...(await myLevel()) }, 200, origin);

  if (action === "save") {
    const parts = cleanParts(body.parts);
    if (!parts) return json({ error: "bad_input" }, 400, origin);
    const usesSpecial = Object.entries(SPECIAL).some(([k, list]) => list.includes(parts[k]));
    if (usesSpecial) {
      const t = await myTemp();
      if (!(await specialOpen(t.temp))) return json({ error: "special_locked" }, 403, origin);
    }
    const { error } = await sb.from("st_char").upsert({ student_id: me.id, parts, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
    if (error) return json({ error: "save_failed" }, 500, origin);
    await sb.rpc("st_xp_add", { p_student: me.id, p_kind: "char_first", p_ref: "", p_xp: 3, p_day_cap: 20 });   // 처음 한 번만(중복 방지)
    return json({ ok: true, ...(await myLevel()) }, 200, origin);
  }

  // list: 우리 반 친구들의 캐릭터(번호 → 조합 코드). 숨긴 것은 빼고 보낸다.
  const { data: mates } = await sb.from("gt_students").select("id,number").eq("class_id", me.class_id);
  // deno-lint-ignore no-explicit-any
  const nm = new Map((mates ?? []).map((m: any) => [m.id, m.number]));
  const { data: rows } = await sb.from("st_char").select("student_id,parts").eq("hidden", false).in("student_id", [...nm.keys()]);
  const chars: Record<string, unknown> = {};
  for (const r of rows ?? []) chars[String(nm.get(r.student_id))] = r.parts;
  return json({ ok: true, me: me.number, chars }, 200, origin);
});
