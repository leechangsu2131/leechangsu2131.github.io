// Supabase Edge Function: practice-hub (도덕 덕목 실천 카드: 하루 한 장, 주간 미션)
// - 학생: get(이번 주 덕목·내 카드·별 개수) / submit(오늘 카드 한 장). 구글 로그인으로 승인된 학생만(swap-market과 같은 방식).
// - 올리면 경험치 +2를 바로 임시로 주고(st_xp_add, 하루 20점 상한), 교사가 「다시 써 보기」를 하면 그 경험치를 취소(void)한다.
// - 주간 미션: 이번 주 덕목으로 별 3개(서로 다른 날 3장)를 모으면 +5(주 1회).
// - 점수는 경험치에만 들어간다. 매너온도에는 넣지 않고, 도덕 교과 평가와도 관계없다.
// - 우리 반 함께 모으기: 이번 주 반 전체 카드 수가 교사가 정한 목표(기본 20장)를 채우면 교사가 정한 보상(글자 40자)이 열린다. 보상은 교사가 직접 주고, 점수는 따로 없다.
// - 교사: t_list(확인 대기) / t_confirm(모두 확인) / t_redo(다시 써 보기) / t_set(이번 주 덕목 고르기) / t_goal(학급 목표·보상 정하기).
// - 글은 한 줄(100자)만, 전화번호·주소·이메일·링크는 막는다. 사진은 아직 받지 않는다(다음 단계).
// - verify_jwt=false 로 배포하고 함수 안에서 방어: 로그인 확인, Origin 확인, 입력 검사, 횟수 제한.
// 비밀값: GT_ALLOW_ORIGIN(필수, 쉼표로 여러 주소)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
const BLOCKED = /https?:|www\.|\.(com|net|kr|io)\b|@|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/i;
// 올해 도덕 단원 기준 덕목(2026-11-20). 화면 문구도 이 목록에서 받아 간다. type: choose=하나 고르기(+선택 한 줄), line=한 줄 쓰기, check=목표 고르고 매일 체크
const VIRTUES = [
  { id: "feel", name: "내 마음 소중히", emoji: "💗", type: "choose", ask: "오늘 내 마음은 어땠나요?", options: ["기뻐요", "신나요", "편안해요", "속상해요", "화나요", "걱정돼요"], note: "왜 그랬는지 한 줄 (안 써도 돼요)" },
  { id: "cheer", name: "나를 격려해요", emoji: "🌟", type: "line", ask: "나에게 해 주고 싶은 격려 한 마디", options: [], note: "나에게 쓰는 한 줄" },
  { id: "diligent", name: "성실하게 해요", emoji: "⏰", type: "check", ask: "오늘 내 목표를 해냈나요?", options: ["매일 운동하기", "등교할 때 반갑게 인사하기", "할 일 먼저 하고 놀기", "책 읽기"], note: "한 줄 (안 써도 돼요)" },
  { id: "family", name: "가족을 아껴요", emoji: "🏠", type: "choose", ask: "오늘 한 가족 사랑 실천은?", options: ["고마워요 말하기", "집안일 돕기", "내 방 정리하기", "약속 지키기"], note: "무엇을 했는지 한 줄 (안 써도 돼요)" },
  { id: "sibling", name: "우애를 지켜요", emoji: "🤝", type: "choose", ask: "손·입·발 중 오늘 한 것은?", options: ["손: 도와주고 안아 주기", "입: 고운 말 하기", "발: 같이 심부름·운동하기"], note: "한 줄 (안 써도 돼요)" },
  { id: "fair", name: "공정하게 해요", emoji: "⚖️", type: "choose", ask: "오늘 공정하게 한 것은?", options: ["순서 지키기", "나눌 때 규칙 정하기", "차례 양보하기"], note: "한 줄 (안 써도 돼요)" },
  { id: "life", name: "생명을 소중히", emoji: "🌱", type: "choose", ask: "오늘 생명을 아낀 일은?", options: ["화분·식물 가꾸기", "꽃 함부로 안 꺾기", "분리배출 하기", "쓰레기 안 버리기"], note: "한 줄 (안 써도 돼요)" },
];
const ROTATION = VIRTUES.map((v) => v.id);
const STAR_GOAL = 3;
const XP_CARD = 2, XP_WEEK = 5, DAY_CAP = 20;
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
const clean = (t: unknown, n: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
type Student = { id: string; number: number; class_id: string; name: string };

// 한국 시간 기준 오늘·이번 주 월요일(YYYY-MM-DD)
function kstToday(): string { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function weekStartOf(day: string): string {
  const d = new Date(day + "T00:00:00Z"); const dow = (d.getUTCDay() + 6) % 7;   // 월=0
  d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10);
}
async function weekVirtue(ws: string): Promise<string> {
  const { data } = await sb.from("st_virtue_week").select("virtue").eq("week_start", ws).maybeSingle();
  if (data && ROTATION.includes(data.virtue)) return data.virtue;
  const n = Math.floor((new Date(ws + "T00:00:00Z").getTime() - new Date("2026-01-05T00:00:00Z").getTime()) / (7 * 86400000));   // 지정이 없으면 순서대로
  return ROTATION[((n % ROTATION.length) + ROTATION.length) % ROTATION.length];
}
// 우리 반 함께 모으기: 이번 주 반 전체 카드 수(확인 대기·확인함, 「다시 써 보기」 제외)와 교사가 정한 목표·보상. 이름·번호는 보내지 않는다.
async function weekGoal(ws: string): Promise<{ goal: number; reward: string }> {
  const { data } = await sb.from("st_virtue_week").select("goal,reward").eq("week_start", ws).maybeSingle();
  return { goal: Number(data?.goal ?? 20), reward: String(data?.reward ?? "") };
}
async function classCount(ids: string[], ws: string): Promise<number> {
  if (!ids.length) return 0;
  const { count } = await sb.from("st_practice").select("id", { count: "exact", head: true }).in("student_id", ids).gte("day", ws).neq("status", "redo");
  return count ?? 0;
}
async function addXp(student: string, kind: string, ref: string, xp: number) {
  await sb.rpc("st_xp_add", { p_student: student, p_kind: kind, p_ref: ref, p_xp: xp, p_day_cap: DAY_CAP });
}

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (!ALLOW_LIST.length) return json({ error: "server_not_configured" }, 500, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  if (!ALLOW_ANY && origin && !ALLOW_LIST.includes(origin)) return json({ error: "forbidden_origin" }, 403, origin);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
  const action = ["get", "submit", "t_list", "t_confirm", "t_redo", "t_set", "t_goal"].includes(body.action) ? body.action : "";
  if (!action) return json({ error: "bad_action" }, 400, origin);
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  if (tooMany("ip:" + ip, 400)) return json({ error: "too_many_attempts" }, 429, origin);
  const g = await whoIs(body.jwt);
  if (!g) return json({ error: "login_required" }, 401, origin);
  const today = kstToday(), ws = weekStartOf(today);

  // ---------------- 교사 ----------------
  if (action.startsWith("t_")) {
    if (!g.teacher) return json({ error: "forbidden" }, 403, origin);
    const { data: cls } = await sb.from("gt_classes").select("id").eq("active", true).limit(1);
    const classId = cls?.[0]?.id; if (!classId) return json({ error: "no_class" }, 404, origin);
    const { data: mates } = await sb.from("gt_students").select("id,number,name").eq("class_id", classId);
    const ids = (mates ?? []).map((m: { id: string }) => m.id);
    if (action === "t_set") {
      const v = String(body.virtue ?? "");
      if (!ROTATION.includes(v)) return json({ error: "bad_input" }, 400, origin);
      const { error } = await sb.from("st_virtue_week").upsert({ week_start: ws, virtue: v, set_at: new Date().toISOString() }, { onConflict: "week_start" });
      return error ? json({ error: "save_failed" }, 500, origin) : json({ ok: true, virtue: v }, 200, origin);
    }
    if (action === "t_goal") {
      const goal = Math.round(Number(body.goal)), reward = clean(body.reward, 40);
      if (!(goal >= 1 && goal <= 500) || BLOCKED.test(reward)) return json({ error: "bad_input" }, 400, origin);
      const { error } = await sb.from("st_virtue_week").upsert({ week_start: ws, virtue: await weekVirtue(ws), goal, reward, set_at: new Date().toISOString() }, { onConflict: "week_start" });
      return error ? json({ error: "save_failed" }, 500, origin) : json({ ok: true, goal, reward }, 200, origin);
    }
    if (action === "t_confirm" || action === "t_redo") {
      const list = (Array.isArray(body.ids) ? body.ids : [body.id]).map((x: unknown) => String(x ?? "")).filter(Boolean).slice(0, 200);
      if (!list.length) return json({ error: "bad_input" }, 400, origin);
      const status = action === "t_confirm" ? "ok" : "redo";
      const { data: rows, error } = await sb.from("st_practice").update({ status }).in("id", list).in("student_id", ids).select("id,student_id");
      if (error) return json({ error: "save_failed" }, 500, origin);
      if (status === "redo") for (const r of rows ?? []) await sb.from("st_xp_log").update({ void: true }).eq("student_id", r.student_id).eq("kind", "virtue").eq("ref", r.id);   // 다시 써 보기: 임시 경험치 취소
      return json({ ok: true, changed: (rows ?? []).length }, 200, origin);
    }
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const { data: rows } = await sb.from("st_practice").select("id,student_id,virtue,day,choice,note,status").in("student_id", ids).gte("day", since).order("day", { ascending: false }).limit(400);
    // deno-lint-ignore no-explicit-any
    const nm = new Map((mates ?? []).map((m: any) => [m.id, m]));
    return json({
      ok: true, week_start: ws, virtue: await weekVirtue(ws), ...(await weekGoal(ws)), class_count: await classCount(ids, ws), virtues: VIRTUES.map((v) => ({ id: v.id, name: v.name, emoji: v.emoji })),
      // deno-lint-ignore no-explicit-any
      cards: (rows ?? []).map((r: any) => ({ id: r.id, num: nm.get(r.student_id)?.number ?? 0, name: nm.get(r.student_id)?.name ?? "", virtue: r.virtue, day: r.day, choice: r.choice, note: r.note, status: r.status })),
    }, 200, origin);
  }

  // ---------------- 학생 ----------------
  if (g.teacher) return json({ error: "teacher_use_t_actions" }, 403, origin);
  const acc = await findAcc(g);
  if (!acc || acc.status !== "approved") return json({ error: "not_approved" }, 403, origin);
  const { data: s } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)").eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
  const me = (s as Student) ?? null;
  if (!me) return json({ error: "no_student" }, 403, origin);
  if (tooMany("st:" + me.id, 120)) return json({ error: "too_many_attempts" }, 429, origin);

  const vid = await weekVirtue(ws);
  const virtue = VIRTUES.find((v) => v.id === vid)!;
  async function state() {
    const { data: cards } = await sb.from("st_practice").select("id,day,choice,note,status").eq("student_id", me!.id).eq("virtue", vid).gte("day", ws).order("day", { ascending: true });
    // deno-lint-ignore no-explicit-any
    const live = (cards ?? []).filter((c: any) => c.status !== "redo");
    const stars = new Set(live.map((c: { day: string }) => c.day)).size;
    // deno-lint-ignore no-explicit-any
    const todayCard = (cards ?? []).find((c: any) => c.day === today) ?? null;
    const { data: mates } = await sb.from("gt_students").select("id").eq("class_id", me!.class_id);
    const cg = await weekGoal(ws);
    const klass = { count: await classCount((mates ?? []).map((m: { id: string }) => m.id), ws), goal: cg.goal, reward: cg.reward };
    return { ok: true, me: me!.number, week_start: ws, virtue, goal: STAR_GOAL, stars, cards: cards ?? [], today: todayCard ? { status: todayCard.status } : null, klass };
  }

  if (action === "get") return json(await state(), 200, origin);

  // submit: 오늘 카드 한 장(「다시 써 보기」를 받은 카드는 다시 올릴 수 있다)
  const choice = clean(body.choice, 40), note = clean(body.note, 100);
  if (virtue.type === "line" ? !note : !virtue.options.includes(choice)) return json({ error: "bad_input" }, 400, origin);
  if (virtue.type === "line" && choice) return json({ error: "bad_input" }, 400, origin);
  if (BLOCKED.test(note)) return json({ error: "blocked_content" }, 400, origin);
  const { data: prev } = await sb.from("st_practice").select("id,status").eq("student_id", me.id).eq("virtue", vid).eq("day", today).maybeSingle();
  let cardId: string;
  if (prev) {
    if (prev.status !== "redo") return json({ error: "already_today" }, 400, origin);
    const { error } = await sb.from("st_practice").update({ choice, note, status: "pending" }).eq("id", prev.id);
    if (error) return json({ error: "save_failed" }, 500, origin);
    cardId = prev.id;
    await sb.from("st_xp_log").update({ void: false }).eq("student_id", me.id).eq("kind", "virtue").eq("ref", cardId);   // 다시 써서 올리면 경험치도 되살린다
  } else {
    const { data: ins, error } = await sb.from("st_practice").insert({ student_id: me.id, virtue: vid, day: today, choice, note }).select("id").single();
    if (error || !ins) return json({ error: error?.code === "23505" ? "already_today" : "save_failed" }, error?.code === "23505" ? 400 : 500, origin);
    cardId = ins.id;
  }
  await addXp(me.id, "virtue", cardId, XP_CARD);
  const st = await state();
  if (st.stars >= STAR_GOAL) await addXp(me.id, "virtue_week", ws + ":" + vid, XP_WEEK);
  return json({ ...st, submitted: true }, 200, origin);
});
