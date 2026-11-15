// Supabase Edge Function: school-tool (접속 현황 · 공지 · 선생님↔학생 메시지)
// 학생 화면 -> (이 함수) -> DB. 학생은 '번호 + 이름'(gt_students 명단)으로 입장합니다.
// verify_jwt=false 로 배포하고 함수 안에서 방어: 명단 확인, 잘못된 입력 잠금(IP), Origin 확인, 길이·횟수 제한.
// 비밀값: GT_ALLOW_ORIGIN(growth-tutor 와 같은 값, 쉼표로 여러 주소), GT_MAX_BAD_CODES(기본 60)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MAX_BAD = Number(Deno.env.get("GT_MAX_BAD_CODES") ?? "60");
const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
const MAX_BODY = 300;

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (!ALLOW_LIST.length) return json({ error: "server_not_configured" }, 500, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  if (!ALLOW_ANY && origin && !ALLOW_LIST.includes(origin)) return json({ error: "forbidden_origin" }, 403, origin);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }
  const action = ["hello", "ping", "send"].includes(body.action) ? body.action : "";
  if (!action) return json({ error: "bad_action" }, 400, origin);

  const num = Number(body.number);
  const key = nameKey(body.name);
  if (!Number.isInteger(num) || num < 1 || num > 60 || !key) return json({ error: "not_found" }, 401, origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  const since10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: bad } = await sb.from("gt_auth_failures").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since10);
  if ((bad ?? 0) >= MAX_BAD) return json({ error: "too_many_attempts" }, 429, origin);

  const { data: found } = await sb.from("gt_students").select("id,number,class_id,gt_classes!inner(active)")
    .eq("number", num).eq("name_key", key).eq("gt_classes.active", true).limit(1);
  const st = found?.[0];
  if (!st) {
    await sb.from("gt_auth_failures").insert({ ip });
    return json({ error: "not_found" }, 401, origin);
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
