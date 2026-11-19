// Supabase Edge Function: swap-market (물물장터: 돈 없이 안 쓰는 물건끼리 바꾸기)
// 흐름: 학생이 물건 글(사진·원하는 것·기한) 올림 → 친구가 "이런 걸 줄 수 있어" 제안(올린 친구와 선생님만 봄)
//       → 올린 친구가 한 명 고름 → 둘이 학교 안 시간·장소를 고르고 서로 OK → 바꾼 뒤 둘 다 "바꿨어요".
// - 학생 확인: 구글 로그인(jwt)으로 승인된 학생(st_accounts)만. 교사는 app_metadata.role === 'teacher'.
// - 돈 이야기·전화번호·주소·이메일은 올릴 수 없다. 시간·장소는 미리 정한 학교 안 후보만 고른다.
// - 사진은 비공개 보관함(swap-photos)에 JPEG 한 장(작게 줄인 것)만. 화면에는 잠깐 쓰는 주소(1시간)로만 보여 준다.
//   교사가 한 주 기록을 내려받은 뒤 '기록 모두 지우기'를 하면 글·제안·사진이 함께 지워진다. 안전장치로 30일 지난 것은 자동 정리.
// - verify_jwt=false 로 배포하고 함수 안에서 방어: 로그인 확인, Origin 확인, 입력 검사, 횟수 제한.
// 비밀값: GT_ALLOW_ORIGIN(필수, 쉼표로 여러 주소)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
const BUCKET = "swap-photos";
const BLOCKED = /https?:|www\.|\.(com|net|kr|io)\b|@|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/i;
const MONEY = /(\d\s*원|천\s*원|만\s*원|현금|돈|계좌|송금|입금|용돈|\bwon\b|\bcash\b)/i;   // 돈으로 사고팔기는 안 된다
const PLACES = ["classroom", "hall", "library", "yard"];            // 교실 · 복도 · 도서관 · 운동장 쉼터(학교 안만)
const SLOTS = ["break", "after_lunch", "afterschool_in"];           // 쉬는 시간 · 점심 먹고 난 뒤 · 방과후 학교 안(끝나기 전)
const DAYS = [1, 2, 3, 7];
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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (!ALLOW_LIST.length) return json({ error: "server_not_configured" }, 500, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  if (!ALLOW_ANY && origin && !ALLOW_LIST.includes(origin)) return json({ error: "forbidden_origin" }, 403, origin);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
  const action = ["list", "post", "offer", "choose", "reopen", "plan", "agree", "done", "praise", "temp", "cancel", "t_list", "t_hide", "t_delete", "t_export", "t_purge"].includes(body.action) ? body.action : "";
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
    const load = async () => {
      const { data: items } = await sb.from("st_swap_items").select("*, st_swap_offers(*)").eq("class_id", classId).order("created_at", { ascending: false }).limit(300);
      const { data: mates } = await sb.from("gt_students").select("id,number,name").eq("class_id", classId);
      return { items: items ?? [], nm: new Map((mates ?? []).map((m: any) => [m.id, `${m.number}번 ${m.name}`])) };
    };
    if (action === "t_hide") {
      await sb.from("st_swap_items").update({ hidden: body.hidden !== false }).eq("id", String(body.id ?? "")).eq("class_id", classId);
      return json({ ok: true }, 200, origin);
    }
    if (action === "t_delete") {
      const { data: it } = await sb.from("st_swap_items").select("id,photo_path,st_swap_offers(photo_path)").eq("id", String(body.id ?? "")).eq("class_id", classId).maybeSingle();
      if (!it) return json({ error: "not_found" }, 404, origin);
      await removePhotos([it.photo_path, ...(it.st_swap_offers ?? []).map((o: any) => o.photo_path)]);
      await sb.from("st_swap_items").delete().eq("id", it.id);
      return json({ ok: true }, 200, origin);
    }
    const { items, nm } = await load();
    const row = (it: any) => ({
      id: it.id, owner: nm.get(it.owner_id) ?? "?", title: it.title, body: it.body, want: it.want, status: it.status, hidden: it.hidden,
      created: it.created_at, ends: it.ends_at, place: it.place, slot: it.slot, owner_done: it.owner_done, offerer_done: it.offerer_done,
      offers: (it.st_swap_offers ?? []).map((o: any) => ({ id: o.id, from: nm.get(o.from_id) ?? "?", give: o.give, note: o.note, chosen: o.id === it.chosen_offer_id, hidden: o.hidden, created: o.created_at, has_photo: !!o.photo_path })),
      has_photo: !!it.photo_path,
    });
    if (action === "t_list") {
      const urls = await signUrls(items.map((i: any) => i.photo_path));
      return json({ ok: true, items: items.map((i: any) => ({ ...row(i), photo: i.photo_path ? urls.get(i.photo_path) ?? "" : "" })) }, 200, origin);
    }
    if (action === "t_export") return json({ ok: true, exported_at: new Date().toISOString(), items: items.map(row) }, 200, origin);
    // t_purge: 학급의 물물장터 기록과 사진을 모두 지운다(먼저 t_export 로 내려받아 두기)
    const paths: (string | null)[] = [];
    for (const i of items as any[]) { paths.push(i.photo_path); for (const o of i.st_swap_offers ?? []) paths.push(o.photo_path); }
    await removePhotos(paths);
    const { error } = await sb.from("st_swap_items").delete().eq("class_id", classId);
    if (error) return json({ error: "delete_failed" }, 500, origin);
    return json({ ok: true, deleted: items.length }, 200, origin);
  }

  // ---------------- 학생 ----------------
  if (g.teacher) return json({ error: "teacher_use_t_actions" }, 403, origin);
  const acc = await findAcc(g);
  if (!acc || acc.status !== "approved") return json({ error: "not_approved" }, 403, origin);
  const { data: s } = await sb.from("gt_students").select("id,number,class_id,name,gt_classes!inner(active)").eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
  const me = (s as Student) ?? null;
  if (!me) return json({ error: "no_student" }, 403, origin);
  if (tooMany("st:" + me.id, 120)) return json({ error: "too_many_attempts" }, 429, origin);
  const now = Date.now();

  async function getItem(id: unknown) {
    const { data: it } = await sb.from("st_swap_items").select("*").eq("id", String(id ?? "")).maybeSingle();
    if (!it || it.class_id !== me!.class_id || it.hidden) return null;
    return it;
  }

  // 매너온도: 모이자(st_meetup_praise)와 바꾸자(st_swap_praise)에서 받은 칭찬을 합친다. 36.5℃에서 시작, 칭찬 1개당 +0.5, 내려가지 않는다.
  const PRAISE = ["thanks", "fun", "kind", "rule", "lead"];
  async function myTemp() {
    const { count: a } = await sb.from("st_meetup_praise").select("id", { count: "exact", head: true }).eq("to_id", me!.id);
    const { count: b } = await sb.from("st_swap_praise").select("id", { count: "exact", head: true }).eq("to_id", me!.id);
    const n = (a ?? 0) + (b ?? 0);
    return { temp: Math.min(99.9, Math.round((36.5 + 0.5 * n) * 10) / 10), count: n, swap_count: b ?? 0 };
  }

  if (action === "temp") return json({ ok: true, ...(await myTemp()) }, 200, origin);   // 모이자 화면이 바꾸자에서 받은 칭찬 수를 더할 때 쓴다

  if (action === "list") {
    if (Math.random() < 0.05) {   // 안전장치: 30일 지난 글은 사진까지 자동 정리
      const old = new Date(now - 30 * 24 * 3600 * 1000).toISOString();
      const { data: olds } = await sb.from("st_swap_items").select("id,photo_path,st_swap_offers(photo_path)").eq("class_id", me.class_id).lt("created_at", old).limit(100);
      for (const o of olds ?? []) { await removePhotos([o.photo_path, ...(o.st_swap_offers ?? []).map((x: any) => x.photo_path)]); await sb.from("st_swap_items").delete().eq("id", o.id); }
    }
    const { data: items } = await sb.from("st_swap_items").select("*, st_swap_offers(*)").eq("class_id", me.class_id).eq("hidden", false).order("created_at", { ascending: false }).limit(60);
    const { data: mates } = await sb.from("gt_students").select("id,number,name").eq("class_id", me.class_id);
    const nm = new Map((mates ?? []).map((m: any) => [m.id, m]));
    const vis = (items ?? []).filter((i: any) => i.status !== "closed");
    const urls = await signUrls(vis.flatMap((i: any) => [i.photo_path, ...(i.st_swap_offers ?? []).filter((o: any) => o.from_id === me.id || i.owner_id === me.id).map((o: any) => o.photo_path)]));
    const doneIds = vis.filter((i: any) => i.status === "done").map((i: any) => i.id);
    const { data: myPr } = doneIds.length ? await sb.from("st_swap_praise").select("item_id,tag").eq("from_id", me.id).in("item_id", doneIds) : { data: [] };
    const prMap = new Map((myPr ?? []).map((x: any) => [x.item_id, x.tag]));
    const out = vis.map((i: any) => {
      const mine = i.owner_id === me.id;
      const offers = (i.st_swap_offers ?? []).filter((o: any) => !o.hidden);
      const myOffer = offers.find((o: any) => o.from_id === me.id);
      const chosen = offers.find((o: any) => o.id === i.chosen_offer_id);
      const inDeal = !!chosen && (mine || chosen.from_id === me.id);
      const shape = (o: any) => ({ id: o.id, from: nm.get(o.from_id)?.number ?? 0, from_name: nm.get(o.from_id)?.name ?? "", give: o.give, note: o.note, photo: o.photo_path ? urls.get(o.photo_path) ?? "" : "", chosen: o.id === i.chosen_offer_id });
      const o = nm.get(i.owner_id);
      return {
        id: i.id, title: i.title, body: i.body, want: i.want, photo: i.photo_path ? urls.get(i.photo_path) ?? "" : "", ends: i.ends_at,
        open: i.status === "open" && new Date(i.ends_at).getTime() > now, status: i.status, mine, owner: o?.number ?? 0, owner_name: o?.name ?? "",
        offer_count: offers.length,
        offers: mine ? offers.map(shape) : [], my_offer: myOffer ? shape(myOffer) : null,
        deal: inDeal ? { with_num: mine ? (nm.get(chosen.from_id)?.number ?? 0) : (o?.number ?? 0), with_name: mine ? (nm.get(chosen.from_id)?.name ?? "") : (o?.name ?? ""), give: chosen.give, place: i.place, slot: i.slot, plan_by_me: i.plan_by === me.id, plan_ok: i.plan_ok, my_done: mine ? i.owner_done : i.offerer_done, other_done: mine ? i.offerer_done : i.owner_done, my_tag: prMap.get(i.id) ?? "" } : null,
      };
    });
    return json({ ok: true, me: me.number, items: out, ...(await myTemp()) }, 200, origin);
  }

  if (action === "post") {
    const title = clean(body.title, 30), text = clean(body.body, 150), want = clean(body.want, 80), days = Number(body.days);
    if (!title || !want || !DAYS.includes(days)) return json({ error: "bad_input" }, 400, origin);
    if (BLOCKED.test(title + text + want)) return json({ error: "blocked_content" }, 400, origin);
    if (MONEY.test(title + text + want)) return json({ error: "no_money" }, 400, origin);
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
    const { count: dayN } = await sb.from("st_swap_items").select("id", { count: "exact", head: true }).eq("owner_id", me.id).gte("created_at", dayAgo);
    if ((dayN ?? 0) >= 5) return json({ error: "too_many_posts" }, 429, origin);
    const { count: openN } = await sb.from("st_swap_items").select("id", { count: "exact", head: true }).eq("owner_id", me.id).in("status", ["open", "matched"]);
    if ((openN ?? 0) >= 3) return json({ error: "too_many_open" }, 429, origin);
    const ph = await savePhoto(body.photo, `${me.class_id}/items`);
    if (ph === "bad") return json({ error: "bad_photo" }, 400, origin);
    const { error } = await sb.from("st_swap_items").insert({ class_id: me.class_id, owner_id: me.id, title, body: text, want, photo_path: ph, ends_at: new Date(now + days * 24 * 3600 * 1000).toISOString() });
    if (error) { if (ph) await removePhotos([ph]); return json({ error: "save_failed" }, 500, origin); }
    return json({ ok: true }, 200, origin);
  }

  const it = await getItem(body.id);
  if (!it) return json({ error: "no_item" }, 404, origin);
  const mine = it.owner_id === me.id;

  if (action === "offer") {
    if (mine) return json({ error: "own_item" }, 400, origin);
    if (it.status !== "open" || new Date(it.ends_at).getTime() <= now) return json({ error: "closed" }, 400, origin);
    const give = clean(body.give, 60), note = clean(body.note, 150);
    if (!give) return json({ error: "bad_input" }, 400, origin);
    if (BLOCKED.test(give + note)) return json({ error: "blocked_content" }, 400, origin);
    if (MONEY.test(give + note)) return json({ error: "no_money" }, 400, origin);
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
    const { data: mineAll } = await sb.from("st_swap_offers").select("id,created_at").eq("from_id", me.id).gte("created_at", dayAgo);
    const { data: prev } = await sb.from("st_swap_offers").select("id,photo_path").eq("item_id", it.id).eq("from_id", me.id).maybeSingle();
    if (!prev && (mineAll?.length ?? 0) >= 15) return json({ error: "too_many_offers" }, 429, origin);
    const ph = await savePhoto(body.photo, `${me.class_id}/offers`);
    if (ph === "bad") return json({ error: "bad_photo" }, 400, origin);
    if (prev) {
      if (it.chosen_offer_id === prev.id) { if (ph) await removePhotos([ph]); return json({ error: "already_chosen" }, 400, origin); }
      const upd: Record<string, unknown> = { give, note }; if (ph) { upd.photo_path = ph; await removePhotos([prev.photo_path]); }
      await sb.from("st_swap_offers").update(upd).eq("id", prev.id);
    } else {
      const { error } = await sb.from("st_swap_offers").insert({ item_id: it.id, from_id: me.id, give, note, photo_path: ph });
      if (error) { if (ph) await removePhotos([ph]); return json({ error: "save_failed" }, 500, origin); }
    }
    return json({ ok: true }, 200, origin);
  }

  if (action === "choose" || action === "reopen" || action === "cancel") {
    if (!mine) return json({ error: "forbidden" }, 403, origin);
    if (action === "cancel") {
      await sb.from("st_swap_items").update({ status: "closed" }).eq("id", it.id);
      return json({ ok: true }, 200, origin);
    }
    if (action === "reopen") {
      if (it.status === "done") return json({ error: "done_already" }, 400, origin);
      await sb.from("st_swap_items").update({ status: "open", chosen_offer_id: null, place: null, slot: null, plan_by: null, plan_ok: false, owner_done: false, offerer_done: false }).eq("id", it.id);
      return json({ ok: true }, 200, origin);
    }
    // choose: 제안 중 한 명 고르기(기한 뒤 2일까지)
    if (it.status === "done" || it.status === "closed") return json({ error: "closed" }, 400, origin);
    if (now > new Date(it.ends_at).getTime() + 2 * 24 * 3600 * 1000) return json({ error: "closed" }, 400, origin);
    const { data: o } = await sb.from("st_swap_offers").select("id,item_id,hidden").eq("id", String(body.offer_id ?? "")).maybeSingle();
    if (!o || o.item_id !== it.id || o.hidden) return json({ error: "no_offer" }, 404, origin);
    await sb.from("st_swap_items").update({ status: "matched", chosen_offer_id: o.id, place: null, slot: null, plan_by: null, plan_ok: false, owner_done: false, offerer_done: false }).eq("id", it.id);
    return json({ ok: true }, 200, origin);
  }

  // plan / agree / done: 고른 두 친구만
  if (!it.chosen_offer_id || it.status === "closed") return json({ error: "no_deal" }, 400, origin);
  const { data: co } = await sb.from("st_swap_offers").select("id,from_id").eq("id", it.chosen_offer_id).maybeSingle();
  if (!co || (!mine && co.from_id !== me.id)) return json({ error: "forbidden" }, 403, origin);
  if (action === "praise") {
    // 바꾸기가 끝난 뒤, 바꾼 친구에게 고마운 마음 남기기(하나 더 고르면 바뀜). 온도는 올라가기만 한다.
    const tag = String(body.tag ?? "");
    if (it.status !== "done") return json({ error: "not_done" }, 400, origin);
    if (!PRAISE.includes(tag)) return json({ error: "bad_input" }, 400, origin);
    const to = mine ? co.from_id : it.owner_id;
    if (!to || to === me.id) return json({ error: "bad_input" }, 400, origin);
    const { error } = await sb.from("st_swap_praise").upsert({ item_id: it.id, from_id: me.id, to_id: to, tag }, { onConflict: "item_id,from_id,to_id" });
    if (error) return json({ error: "save_failed" }, 500, origin);
    return json({ ok: true, ...(await myTemp()) }, 200, origin);
  }
  if (action === "plan") {
    if (it.status !== "matched") return json({ error: "no_deal" }, 400, origin);
    const place = String(body.place ?? ""), slot = String(body.slot ?? "");
    if (!PLACES.includes(place) || !SLOTS.includes(slot)) return json({ error: "bad_input" }, 400, origin);
    await sb.from("st_swap_items").update({ place, slot, plan_by: me.id, plan_ok: false }).eq("id", it.id);
    return json({ ok: true }, 200, origin);
  }
  if (action === "agree") {
    if (!it.place || !it.slot || it.plan_by === me.id) return json({ error: "bad_input" }, 400, origin);
    await sb.from("st_swap_items").update({ plan_ok: true }).eq("id", it.id);
    return json({ ok: true }, 200, origin);
  }
  // done
  if (!it.plan_ok) return json({ error: "no_plan" }, 400, origin);
  const upd: Record<string, unknown> = mine ? { owner_done: true } : { offerer_done: true };
  const both = mine ? it.offerer_done : it.owner_done;
  if (both) upd.status = "done";
  await sb.from("st_swap_items").update(upd).eq("id", it.id);
  return json({ ok: true, done: !!both }, 200, origin);
});
