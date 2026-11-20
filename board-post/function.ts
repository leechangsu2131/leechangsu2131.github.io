// Supabase Edge Function: board-post (학급 온라인 게시판 — 3-2 매체 단원 「온라인 상황에서 글을 써요」 실습)
// 학생: 글감(주제)별로 글쓰기(글씨 크기·색·그림말·사진), 이름은 실명/별명 고르기, 댓글(질문·칭찬·감사·경험), 공감(♥), 내 글 고쳐 쓰기·지우기.
// 교사(app_metadata.role === 'teacher'): 글감 만들기/열고 닫기, 글·댓글 숨기기·삭제, 기록 내려받기(t_ 동작).
// - 글은 바로 공개. 전화번호·이메일·주소(링크)는 올릴 수 없다. 별명에 반 친구 실명은 쓸 수 없다. 교사는 별명 글도 실명으로 본다.
// - 사진은 비공개 보관함(board-photos)에 JPEG 한 장(작게 줄인 것)만. 화면에는 임시 주소(1시간)로만 보여 준다. 30일 지난 사진은 자동 정리.
// - 학생 이름·글·사진은 외부 AI 로 보내지 않는다.
// - verify_jwt=false 로 배포하고 함수 안에서 방어: 로그인 확인, Origin 확인, 입력 검사, 횟수 제한.
// 비밀값: GT_ALLOW_ORIGIN(필수, 쉼표로 여러 주소)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
const BUCKET = "board-photos";
const BLOCKED = /https?:|www\.|\.(com|net|kr|io)\b|@|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/i;
const PHOTO_MAX = 200_000;                                           // 줄인 JPEG 최대 크기(바이트)
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

// 사진(JPEG data URL) 저장 → 경로. 잘못된 사진이면 null.
async function savePhoto(dataUrl: unknown, folder: string): Promise<string | null | "bad"> {
  if (dataUrl === undefined || dataUrl === null || dataUrl === "") return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl));
  if (!m) return "bad";
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); } catch { return "bad"; }
  if (bytes.length < 200 || bytes.length > PHOTO_MAX || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return "bad";
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  return error ? "bad" : path;
}
async function signUrls(paths: (string | null)[]) {
  const real = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!real.length) return out;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(real, 3600);
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  return out;
}
async function removePhotos(paths: (string | null)[]) {
  const real = paths.filter((p): p is string => !!p);
  for (let i = 0; i < real.length; i += 100) await sb.storage.from(BUCKET).remove(real.slice(i, i + 100));
}


// 유튜브 주소 → 영상 번호(11글자). youtube.com(watch·shorts·embed)와 youtu.be 만 받는다.
function ytParse(u: unknown): { id: string; kind: "video" | "short" } | null {
  let url: URL;
  try { url = new URL(String(u ?? "").trim().slice(0, 300)); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  let id = "", kind: "video" | "short" = "video";
  if (host === "youtu.be") id = url.pathname.split("/")[1] ?? "";
  else if (host === "youtube.com") {
    const seg = url.pathname.split("/").filter(Boolean);
    if (seg[0] === "watch") id = url.searchParams.get("v") ?? "";
    else if (seg[0] === "shorts") { id = seg[1] ?? ""; kind = "short"; }
    else if (seg[0] === "embed") id = seg[1] ?? "";
  } else return null;
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? { id, kind } : null;
}
// 유튜브에 그 영상이 있고 퍼 와서 볼 수 있는지 확인(제목도 가져옴). 비공개·삭제·퍼가기 금지 영상은 못 쓴다.
async function ytCheck(id: string): Promise<{ ok: true; title: string } | { ok: false; reason: "not_found" | "check_failed" }> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { signal: ctl.signal });
    if (r.status === 401 || r.status === 403 || r.status === 404) return { ok: false, reason: "not_found" };
    if (!r.ok) return { ok: false, reason: "check_failed" };
    const j = await r.json();
    return { ok: true, title: clean(j.title, 100) };
  } catch { return { ok: false, reason: "check_failed" }; } finally { clearTimeout(t); }
}

const EMOJIS = ["😀","😢","😮","😍","😡","😴","👍","👏","🎉","❤️","⭐","🎂","🎆","😋","🙏","💪"];   // 그림말(미리 정한 것만)
const COLORS = ["black", "red", "blue", "green", "purple", "orange"];
const KINDS = ["question", "praise", "thanks", "story"];
const DEFAULT_TOPIC = "자유롭게 쓰기";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (!ALLOW_LIST.length) return json({ error: "server_not_configured" }, 500, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  if (!ALLOW_ANY && origin && !ALLOW_LIST.includes(origin)) return json({ error: "forbidden_origin" }, 403, origin);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
  const action = ["topics", "list", "post", "edit", "delete", "comment", "uncomment", "like", "t_topics", "t_topic_add", "t_topic_set", "t_topic_delete", "t_list", "t_hide", "t_delete", "t_export", "v_list", "v_add", "v_like", "v_delete", "t_v_list", "t_v_approve", "t_v_hide", "t_v_delete", "t_v_enable"].includes(body.action) ? body.action : "";
  if (!action) return json({ error: "bad_action" }, 400, origin);
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  if (tooMany("ip:" + ip, 400)) return json({ error: "too_many_attempts" }, 429, origin);
  const g = await whoIs(body.jwt);
  if (!g) return json({ error: "login_required" }, 401, origin);

  // 사진 기한 정리(안전망): 30일 지난 글의 사진은 지운다
  async function sweepPhotos() {
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data } = await sb.from("bd_posts").select("id,photo_path").not("photo_path", "is", null).lt("created_at", old).limit(50);
    if (data?.length) { await removePhotos(data.map((d) => d.photo_path)); await sb.from("bd_posts").update({ photo_path: null }).in("id", data.map((d) => d.id)); }
  }
  const names = (m: { number: number; name: string }) => `${m.number}번 ${m.name}`;
  // deno-lint-ignore no-explicit-any
  const cleanEmojis = (t: unknown) => Array.from(String(t ?? "").replace(/\uFE0F/g, "")).filter((c, i, a) => EMOJIS.some((e) => e.replace(/\uFE0F/g, "") === c)).slice(0, 8).join("");

  // ---------------- 교사 ----------------
  if (action.startsWith("t_")) {
    if (!g.teacher) return json({ error: "forbidden" }, 403, origin);
    const { data: cls } = await sb.from("gt_classes").select("id").eq("active", true).limit(1);
    const classId = cls?.[0]?.id; if (!classId) return json({ error: "no_class" }, 404, origin);
    if (action === "t_topics") {
      const { data } = await sb.from("bd_topics").select("id,title,guide,open,created_at").eq("class_id", classId).order("created_at", { ascending: false });
      return json({ ok: true, topics: data ?? [] }, 200, origin);
    }
    if (action === "t_topic_add") {
      const title = clean(body.title, 40), guide = clean(body.guide, 200);
      if (!title) return json({ error: "bad_input" }, 400, origin);
      const { error } = await sb.from("bd_topics").insert({ class_id: classId, title, guide });
      return error ? json({ error: "save_failed" }, 500, origin) : json({ ok: true }, 200, origin);
    }
    if (action === "t_topic_set") {
      await sb.from("bd_topics").update({ open: body.open !== false }).eq("id", String(body.id ?? "")).eq("class_id", classId);
      return json({ ok: true }, 200, origin);
    }
    if (action === "t_topic_delete") {
      const id = String(body.id ?? "");
      const { data: ps } = await sb.from("bd_posts").select("photo_path").eq("topic_id", id).eq("class_id", classId);
      await removePhotos((ps ?? []).map((p) => p.photo_path));
      await sb.from("bd_topics").delete().eq("id", id).eq("class_id", classId);
      return json({ ok: true }, 200, origin);
    }
    if (action === "t_hide" || action === "t_delete") {
      const table = body.kind === "comment" ? "bd_comments" : "bd_posts";
      const id = String(body.id ?? "");
      if (action === "t_hide") { await sb.from(table).update({ hidden: body.hidden !== false }).eq("id", id).eq("class_id", classId); return json({ ok: true }, 200, origin); }
      if (table === "bd_posts") {
        const { data: p } = await sb.from("bd_posts").select("photo_path").eq("id", id).eq("class_id", classId).maybeSingle();
        if (p?.photo_path) await removePhotos([p.photo_path]);
      }
      await sb.from(table).delete().eq("id", id).eq("class_id", classId);
      return json({ ok: true }, 200, origin);
    }
    if (action.startsWith("t_v_")) {
      if (action === "t_v_enable") {
        await sb.from("bd_settings").upsert({ class_id: classId, videos_enabled: body.enabled === true });
        return json({ ok: true, enabled: body.enabled === true }, 200, origin);
      }
      if (action === "t_v_approve" || action === "t_v_hide" || action === "t_v_delete") {
        const id = String(body.id ?? "");
        if (action === "t_v_delete") await sb.from("bd_videos").delete().eq("id", id).eq("class_id", classId);
        else await sb.from("bd_videos").update(action === "t_v_approve" ? { approved: body.approved !== false } : { hidden: body.hidden !== false }).eq("id", id).eq("class_id", classId);
        return json({ ok: true }, 200, origin);
      }
      // t_v_list: 확인 전·숨긴 영상까지, 실명으로
      const { data: st } = await sb.from("bd_settings").select("videos_enabled").eq("class_id", classId).maybeSingle();
      const { data: vs } = await sb.from("bd_videos").select("*, bd_video_likes(student_id)").eq("class_id", classId).order("created_at", { ascending: false }).limit(200);
      const { data: mates } = await sb.from("gt_students").select("id,number,name").eq("class_id", classId);
      const nm = new Map((mates ?? []).map((m) => [m.id, names(m)]));
      // deno-lint-ignore no-explicit-any
      return json({ ok: true, enabled: !!st?.videos_enabled, videos: (vs ?? []).map((v: any) => ({ id: v.id, yt: v.yt_id, kind: v.kind, title: v.title, note: v.note, author: nm.get(v.author_id) ?? "?", shown_as: v.show_real ? "실명" : "별명 " + v.nick, approved: v.approved, hidden: v.hidden, likes: (v.bd_video_likes ?? []).length, created: v.created_at })) }, 200, origin);
    }
    // t_list / t_export: 숨긴 글까지, 실명으로
    let q = sb.from("bd_posts").select("*, bd_comments(*), bd_likes(student_id)").eq("class_id", classId).order("created_at", { ascending: false }).limit(300);
    if (body.topic_id) q = q.eq("topic_id", String(body.topic_id));
    const { data: posts } = await q;
    const { data: mates } = await sb.from("gt_students").select("id,number,name").eq("class_id", classId);
    const nm = new Map((mates ?? []).map((m) => [m.id, names(m)]));
    const { data: tps } = await sb.from("bd_topics").select("id,title").eq("class_id", classId);
    const tm = new Map((tps ?? []).map((t) => [t.id, t.title]));
    // deno-lint-ignore no-explicit-any
    const rows = (posts ?? []).map((p: any) => ({
      id: p.id, topic: tm.get(p.topic_id) ?? "", author: nm.get(p.author_id) ?? "?", shown_as: p.show_real ? "실명" : "별명 " + p.nick, title: p.title, body: p.body, size: p.size, color: p.color, emojis: p.emojis,
      hidden: p.hidden, created: p.created_at, edited: p.edited_at, likes: (p.bd_likes ?? []).length, has_photo: !!p.photo_path, photo_path: p.photo_path,
      // deno-lint-ignore no-explicit-any
      comments: (p.bd_comments ?? []).sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : 1)).map((c: any) => ({ id: c.id, author: nm.get(c.author_id) ?? "?", shown_as: c.show_real ? "실명" : "별명 " + c.nick, kind: c.kind, body: c.body, hidden: c.hidden, created: c.created_at })),
    }));
    if (action === "t_export") return json({ ok: true, exported_at: new Date().toISOString(), posts: rows.map(({ photo_path: _p, ...r }) => r) }, 200, origin);
    const urls = await signUrls(rows.map((r) => r.photo_path));
    return json({ ok: true, posts: rows.map(({ photo_path, ...r }) => ({ ...r, photo: photo_path ? urls.get(photo_path) ?? "" : "" })) }, 200, origin);
  }

  // ---------------- 학생 ----------------
  if (g.teacher) return json({ error: "teacher_use_t_actions" }, 403, origin);
  const acc = await findAcc(g);
  if (!acc || acc.status !== "approved") return json({ error: "not_approved" }, 403, origin);
  const { data: s } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)").eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
  const me = (s as Student) ?? null;
  if (!me) return json({ error: "no_student" }, 403, origin);
  if (tooMany("st:" + me.id, 200)) return json({ error: "too_many_attempts" }, 429, origin);
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  if (Math.random() < 0.03) await sweepPhotos();

  // 글감 목록(없으면 기본 글감 하나를 만든다)
  async function topicList() {
    let { data } = await sb.from("bd_topics").select("id,title,guide,open").eq("class_id", me!.class_id).order("created_at", { ascending: true });
    if (!data?.length) {
      await sb.from("bd_topics").insert({ class_id: me!.class_id, title: DEFAULT_TOPIC, guide: "하고 싶은 이야기를 자유롭게 써 보세요." });
      ({ data } = await sb.from("bd_topics").select("id,title,guide,open").eq("class_id", me!.class_id).order("created_at", { ascending: true }));
    }
    return data ?? [];
  }
  // 이름 검사: 실명/별명 고르기 (별명 1~10자, 주소·전화·이메일 불가, 반 친구 실명 불가)
  async function pickName(): Promise<{ show_real: boolean; nick: string } | string> {
    if (body.as !== "nick") return { show_real: true, nick: "" };
    const nick = clean(body.nick, 10);
    if (!nick) return "nick_required";
    if (BLOCKED.test(nick)) return "blocked_content";
    const { data: mates } = await sb.from("gt_students").select("name").eq("class_id", me!.class_id);
    const key = nick.normalize("NFC").replace(/\s+/g, "").toLowerCase();
    if ((mates ?? []).some((m) => { const k = String(m.name ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase(); return k.length >= 2 && key.includes(k); })) return "nick_is_name";
    return { show_real: false, nick };
  }
  const shownName = (p: { author_id: string; show_real: boolean; nick: string }, nm: Map<string, string>) => (p.show_real ? nm.get(p.author_id) ?? "" : p.nick);

  // ---------- 영상 모음(유튜브 링크만) ----------
  if (action.startsWith("v_")) {
    const { data: st } = await sb.from("bd_settings").select("videos_enabled").eq("class_id", me.class_id).maybeSingle();
    if (!st?.videos_enabled) return json({ ok: true, enabled: false, videos: [] }, 200, origin);
    if (action === "v_list") {
      const { data: vs } = await sb.from("bd_videos").select("*, bd_video_likes(student_id)").eq("class_id", me.class_id).eq("hidden", false).order("created_at", { ascending: false }).limit(100);
      const { data: mates } = await sb.from("gt_students").select("id,name").eq("class_id", me.class_id);
      const nm = new Map((mates ?? []).map((m) => [m.id, m.name as string]));
      // 승인된 영상 + 내가 올린 확인 전 영상만 보인다
      // deno-lint-ignore no-explicit-any
      const list = (vs ?? []).filter((v: any) => v.approved || v.author_id === me.id).map((v: any) => ({
        id: v.id, yt: v.yt_id, kind: v.kind, title: v.title, note: v.note, author: v.show_real ? nm.get(v.author_id) ?? "" : v.nick, mine: v.author_id === me.id, approved: v.approved,
        likes: (v.bd_video_likes ?? []).length, liked: (v.bd_video_likes ?? []).some((l: { student_id: string }) => l.student_id === me.id), created: v.created_at,
      }));
      return json({ ok: true, enabled: true, videos: list }, 200, origin);
    }
    if (action === "v_add") {
      if (body.confirm !== true) return json({ error: "confirm_required" }, 400, origin);
      const y = ytParse(body.url);
      if (!y) return json({ error: "bad_video" }, 400, origin);
      const note = clean(body.note, 100);
      if (note && BLOCKED.test(note)) return json({ error: "blocked_content" }, 400, origin);
      const nameRes = await pickName();
      if (typeof nameRes === "string") return json({ error: nameRes }, 400, origin);
      if (tooMany("bdv:" + me.id, 3)) return json({ error: "too_fast" }, 429, origin);
      const { count: dayN } = await sb.from("bd_videos").select("id", { count: "exact", head: true }).eq("author_id", me.id).gte("created_at", dayAgo);
      if ((dayN ?? 0) >= 5) return json({ error: "too_many_posts" }, 429, origin);
      const { data: dup } = await sb.from("bd_videos").select("id").eq("class_id", me.class_id).eq("yt_id", y.id).maybeSingle();
      if (dup) return json({ error: "duplicate_video" }, 400, origin);
      const chk = await ytCheck(y.id);
      if (!chk.ok) return json({ error: chk.reason === "not_found" ? "video_not_found" : "video_check_failed" }, chk.reason === "not_found" ? 400 : 502, origin);
      const { error } = await sb.from("bd_videos").insert({ class_id: me.class_id, author_id: me.id, ...nameRes, yt_id: y.id, kind: y.kind, title: chk.title, note, approved: false });
      return error ? json({ error: "save_failed" }, 500, origin) : json({ ok: true, pending: true }, 200, origin);
    }
    if (action === "v_delete") {
      const { data: v } = await sb.from("bd_videos").select("id,author_id").eq("id", String(body.id ?? "")).eq("class_id", me.class_id).maybeSingle();
      if (!v || v.author_id !== me.id) return json({ error: "forbidden" }, 403, origin);
      await sb.from("bd_videos").delete().eq("id", v.id);
      return json({ ok: true }, 200, origin);
    }
    // v_like
    const { data: v } = await sb.from("bd_videos").select("id,author_id,approved,hidden").eq("id", String(body.id ?? "")).eq("class_id", me.class_id).maybeSingle();
    if (!v || v.hidden || !v.approved) return json({ error: "no_post" }, 404, origin);
    if (v.author_id === me.id) return json({ error: "own_post" }, 400, origin);
    const { data: had } = await sb.from("bd_video_likes").select("video_id").eq("video_id", v.id).eq("student_id", me.id).maybeSingle();
    if (had) { await sb.from("bd_video_likes").delete().eq("video_id", v.id).eq("student_id", me.id); return json({ ok: true, liked: false }, 200, origin); }
    await sb.from("bd_video_likes").insert({ video_id: v.id, student_id: me.id });
    return json({ ok: true, liked: true }, 200, origin);
  }

  if (action === "topics") return json({ ok: true, me: me.number, topics: await topicList() }, 200, origin);

  if (action === "list") {
    const topics = await topicList();
    const tid = String(body.topic_id ?? topics[0]?.id ?? "");
    const topic = topics.find((t) => t.id === tid);
    if (!topic) return json({ error: "no_topic" }, 404, origin);
    const { data: posts } = await sb.from("bd_posts").select("*, bd_comments(*), bd_likes(student_id)").eq("class_id", me.class_id).eq("topic_id", tid).eq("hidden", false).order("created_at", { ascending: false }).limit(50);
    const { data: mates } = await sb.from("gt_students").select("id,name").eq("class_id", me.class_id);
    const nm = new Map((mates ?? []).map((m) => [m.id, m.name as string]));
    const urls = await signUrls((posts ?? []).map((p) => p.photo_path));
    // deno-lint-ignore no-explicit-any
    const list = (posts ?? []).map((p: any) => ({
      id: p.id, author: shownName(p, nm), mine: p.author_id === me.id, title: p.title, body: p.body, size: p.size, color: p.color, emojis: p.emojis,
      photo: p.photo_path ? urls.get(p.photo_path) ?? "" : "", created: p.created_at, edited: p.edited_at,
      likes: (p.bd_likes ?? []).length, liked: (p.bd_likes ?? []).some((l: { student_id: string }) => l.student_id === me.id),
      comments: (p.bd_comments ?? []).filter((c: { hidden: boolean }) => !c.hidden)
        // deno-lint-ignore no-explicit-any
        .sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : 1))
        // deno-lint-ignore no-explicit-any
        .map((c: any) => ({ id: c.id, author: shownName(c, nm), mine: c.author_id === me.id, kind: c.kind, body: c.body, created: c.created_at })),
    }));
    return json({ ok: true, me: me.number, topic, topics, posts: list }, 200, origin);
  }

  if (action === "post" || action === "edit") {
    const title = clean(body.title, 30);
    const text = String(body.body ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 500);
    if (!title || !text) return json({ error: "empty" }, 400, origin);
    if (BLOCKED.test(title) || BLOCKED.test(text)) return json({ error: "blocked_content" }, 400, origin);
    const size = body.size === "big" ? "big" : "normal";
    const color = COLORS.includes(String(body.color)) ? String(body.color) : "black";
    const emojis = cleanEmojis(body.emojis);
    const nameRes = await pickName();
    if (typeof nameRes === "string") return json({ error: nameRes }, 400, origin);
    if (action === "post") {
      if (tooMany("bdp:" + me.id, 4)) return json({ error: "too_fast" }, 429, origin);
      const { count: dayN } = await sb.from("bd_posts").select("id", { count: "exact", head: true }).eq("author_id", me.id).gte("created_at", dayAgo);
      if ((dayN ?? 0) >= 10) return json({ error: "too_many_posts" }, 429, origin);
      const { data: topic } = await sb.from("bd_topics").select("id,open").eq("id", String(body.topic_id ?? "")).eq("class_id", me.class_id).maybeSingle();
      if (!topic) return json({ error: "no_topic" }, 404, origin);
      if (!topic.open) return json({ error: "topic_closed" }, 403, origin);
      const path = await savePhoto(body.photo, me.class_id);
      if (path === "bad") return json({ error: "bad_photo" }, 400, origin);
      const { error } = await sb.from("bd_posts").insert({ class_id: me.class_id, topic_id: topic.id, author_id: me.id, ...nameRes, title, body: text, size, color, emojis, photo_path: path });
      if (error) { if (path) await removePhotos([path]); return json({ error: "save_failed" }, 500, origin); }
      return json({ ok: true }, 200, origin);
    }
    // edit: 내 글만. 사진은 새로 보내면 바꾸고, remove_photo 면 지운다.
    const { data: p } = await sb.from("bd_posts").select("id,author_id,photo_path,topic_id").eq("id", String(body.id ?? "")).eq("class_id", me.class_id).maybeSingle();
    if (!p || p.author_id !== me.id) return json({ error: "forbidden" }, 403, origin);
    const { data: topic } = await sb.from("bd_topics").select("open").eq("id", p.topic_id).maybeSingle();
    if (!topic?.open) return json({ error: "topic_closed" }, 403, origin);
    let photo_path = p.photo_path as string | null;
    if (body.photo) {
      const path = await savePhoto(body.photo, me.class_id);
      if (path === "bad" || !path) return json({ error: "bad_photo" }, 400, origin);
      if (photo_path) await removePhotos([photo_path]);
      photo_path = path;
    } else if (body.remove_photo === true && photo_path) { await removePhotos([photo_path]); photo_path = null; }
    const { error } = await sb.from("bd_posts").update({ ...nameRes, title, body: text, size, color, emojis, photo_path, edited_at: new Date().toISOString() }).eq("id", p.id);
    return error ? json({ error: "save_failed" }, 500, origin) : json({ ok: true }, 200, origin);
  }

  if (action === "delete") {
    const { data: p } = await sb.from("bd_posts").select("id,author_id,photo_path").eq("id", String(body.id ?? "")).eq("class_id", me.class_id).maybeSingle();
    if (!p || p.author_id !== me.id) return json({ error: "forbidden" }, 403, origin);
    if (p.photo_path) await removePhotos([p.photo_path]);
    await sb.from("bd_posts").delete().eq("id", p.id);
    return json({ ok: true }, 200, origin);
  }

  if (action === "comment") {
    const kind = String(body.kind ?? "");
    const text = clean(body.body, 100);
    if (!KINDS.includes(kind) || !text) return json({ error: "empty" }, 400, origin);
    if (BLOCKED.test(text)) return json({ error: "blocked_content" }, 400, origin);
    const nameRes = await pickName();
    if (typeof nameRes === "string") return json({ error: nameRes }, 400, origin);
    if (tooMany("bdc:" + me.id, 8)) return json({ error: "too_fast" }, 429, origin);
    const { count: dayN } = await sb.from("bd_comments").select("id", { count: "exact", head: true }).eq("author_id", me.id).gte("created_at", dayAgo);
    if ((dayN ?? 0) >= 60) return json({ error: "too_many_posts" }, 429, origin);
    const { data: p } = await sb.from("bd_posts").select("id,hidden,topic_id,bd_topics(open)").eq("id", String(body.post_id ?? "")).eq("class_id", me.class_id).maybeSingle();
    // deno-lint-ignore no-explicit-any
    if (!p || p.hidden) return json({ error: "no_post" }, 404, origin);
    // deno-lint-ignore no-explicit-any
    if (!(p as any).bd_topics?.open) return json({ error: "topic_closed" }, 403, origin);
    const { error } = await sb.from("bd_comments").insert({ post_id: p.id, class_id: me.class_id, author_id: me.id, ...nameRes, kind, body: text });
    return error ? json({ error: "save_failed" }, 500, origin) : json({ ok: true }, 200, origin);
  }

  if (action === "uncomment") {
    const { data: c } = await sb.from("bd_comments").select("id,author_id").eq("id", String(body.id ?? "")).eq("class_id", me.class_id).maybeSingle();
    if (!c || c.author_id !== me.id) return json({ error: "forbidden" }, 403, origin);
    await sb.from("bd_comments").delete().eq("id", c.id);
    return json({ ok: true }, 200, origin);
  }

  // like: 누르면 공감, 다시 누르면 취소. 내 글에는 못 누른다.
  const { data: p } = await sb.from("bd_posts").select("id,author_id,hidden").eq("id", String(body.post_id ?? "")).eq("class_id", me.class_id).maybeSingle();
  if (!p || p.hidden) return json({ error: "no_post" }, 404, origin);
  if (p.author_id === me.id) return json({ error: "own_post" }, 400, origin);
  const { data: had } = await sb.from("bd_likes").select("post_id").eq("post_id", p.id).eq("student_id", me.id).maybeSingle();
  if (had) { await sb.from("bd_likes").delete().eq("post_id", p.id).eq("student_id", me.id); return json({ ok: true, liked: false }, 200, origin); }
  await sb.from("bd_likes").insert({ post_id: p.id, student_id: me.id });
  return json({ ok: true, liked: true }, 200, origin);
});
