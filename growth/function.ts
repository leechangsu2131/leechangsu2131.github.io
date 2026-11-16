// Supabase Edge Function: growth-tutor (3판, 구글 로그인 + 번호·이름 입장)
// 학생 화면 -> (이 함수) -> Gemini 또는 Groq API, 그리고 DB 저장.
// 학생 확인 방법 두 가지(school-tool 과 같은 방식):
//  1) 구글 로그인(Supabase Auth): 화면이 받은 로그인 토큰(jwt)을 이 함수가 Supabase 에 물어 확인한다.
//     교사가 승인한 계정(st_accounts)만 들어올 수 있고, 번호는 그 계정에 연결된 학생의 것을 쓴다.
//  2) 번호 + 이름(gt_students 명단): ST_ALLOW_NAME_LOGIN=0 으로 끌 수 있다(기본은 켜짐. school-tool 과 같은 스위치).
// - verify_jwt=false 로 배포하고 함수 안에서 직접 방어: 토큰/명단 확인, 잘못된 입력 잠금(IP), Origin 확인,
//   입력 크기 제한, 활동당 횟수 제한, 학급별 하루 상한.
// - AI 키·모델은 비밀값에만 둡니다. 학생 이름은 AI에 보내지 않고, 학생 글은 로그에 남기지 않습니다.
// 비밀값: GT_ALLOW_ORIGIN(필수, 쉼표로 여러 주소 가능),
//        GT_PROVIDER(기본 gemini. 쉼표로 여러 개면 앞에서부터 시도, 실패하면 다음으로: 예 gemini,groq),
//        GEMINI_API_KEY / GEMINI_MODEL (또는 GT_GEMINI_MODEL), GROQ_API_KEY / GROQ_MODEL (또는 GT_GROQ_MODEL),
//        GT_MAX_FEEDBACK(기본 3), GT_DAILY_CAP_PER_CLASS(기본 300), GT_MAX_BAD_CODES(기본 60, 10분 안 잘못 입력 횟수/IP),
//        ST_ALLOW_NAME_LOGIN(기본 1, 0 이면 번호+이름 입장을 끔)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const STEPS = ["c2", "c3", "c8", "c5", "c6", "c7"];
const MAX_FEEDBACK = Number(Deno.env.get("GT_MAX_FEEDBACK") ?? "3");
const DAILY_CAP = Number(Deno.env.get("GT_DAILY_CAP_PER_CLASS") ?? "300");
const MAX_BAD = Number(Deno.env.get("GT_MAX_BAD_CODES") ?? "60");
const ALLOW_LIST = (Deno.env.get("GT_ALLOW_ORIGIN") ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const ALLOW_ANY = ALLOW_LIST.includes("*");
const ALLOW_NAME_LOGIN = (Deno.env.get("ST_ALLOW_NAME_LOGIN") ?? "1") !== "0";
const tokenCache = new Map<string, { uid: string; email: string; name: string; exp: number }>();   // 같은 토큰을 60초 동안 다시 묻지 않는다

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function corsHeaders(origin: string | null) {
  const allow = ALLOW_ANY ? "*" : (origin && ALLOW_LIST.includes(origin) ? origin : ALLOW_LIST[0] ?? "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });
}

// 이름 비교용: 공백 제거, 한글 조합 형태 통일, 소문자(DB 의 name_key 와 같은 규칙)
function nameKey(t: unknown): string {
  return String(t ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase().slice(0, 40);
}

// 전화번호·이메일·긴 숫자열을 AI에 보내기 전에 가린다.
function redact(v: unknown): unknown {
  if (typeof v === "string") {
    return v
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[메일]")
      .replace(/\d[\d\s-]{6,}\d/g, "[숫자]")
      .replace(/<\/?answer>/gi, "");
  }
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redact(x)]));
  }
  return v;
}

async function callOne(provider: string, system: string, user: string): Promise<{ text: string; provider: string; model: string }> {
  if (provider === "groq") {
    const key = Deno.env.get("GROQ_API_KEY");
    const model = Deno.env.get("GT_GROQ_MODEL") ?? Deno.env.get("GROQ_MODEL");
    if (!key || !model) throw new Error("GROQ_API_KEY / GROQ_MODEL 이 설정되지 않았습니다.");
    // gpt-oss 계열은 추론(생각) 토큰도 답변 길이 제한에 포함되므로, 추론을 짧게 하고 여유를 둔다.
    const reasoning = model.startsWith("openai/gpt-oss");
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0.4,
        ...(reasoning ? { max_completion_tokens: 1500, reasoning_effort: "low" } : { max_tokens: 300 }),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`Groq ${r.status}`);
    const j = await r.json();
    return { text: j?.choices?.[0]?.message?.content ?? "", provider, model };
  }
  if (provider === "gemini") {
    const key = Deno.env.get("GEMINI_API_KEY");
    const model = Deno.env.get("GT_GEMINI_MODEL") ?? Deno.env.get("GEMINI_MODEL");
    if (!key || !model) throw new Error("GEMINI_API_KEY / GEMINI_MODEL 이 설정되지 않았습니다.");
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
        }),
      },
    );
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const j = await r.json();
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    return { text, provider, model };
  }
  throw new Error("GT_PROVIDER 는 groq 또는 gemini 로 설정해야 합니다.");
}

// GT_PROVIDER 는 쉼표로 여러 개 가능(예: "gemini,groq"). 앞에서부터 시도하고, 실패하면 다음 서비스로 넘어간다.
async function callLLM(system: string, user: string): Promise<{ text: string; provider: string; model: string }> {
  const list = (Deno.env.get("GT_PROVIDER") ?? "gemini").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  const errs: string[] = [];
  for (const p of list) {
    try {
      const out = await callOne(p, system, user);
      if (out.text && out.text.trim()) return out;
      errs.push(`${p}: 빈 응답`);
    } catch (e) { errs.push(`${p}: ${(e as Error).message}`); }
  }
  throw new Error(errs.join(" / ") || "GT_PROVIDER 설정이 없습니다.");
}

function clean(t: string): string {
  return t.replace(/[*#`_>]/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 500);
}

type Student = { id: string; number: number; class_id: string };

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

// 교사가 미리 등록해 둔 학교 계정(auth_id 비어 있음)은 처음 구글 로그인 때 연결한다(school-tool 과 같은 규칙)
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

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, origin); }

  const action = ["hello", "final", "feedback"].includes(body.action) ? body.action : "feedback";

  // 잘못된 입력 잠금(IP 기준)
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: bad } = await sb.from("gt_auth_failures").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since);
  if ((bad ?? 0) >= MAX_BAD) return json({ error: "too_many_attempts" }, 429, origin);

  // ---------- 학생 확인: 구글 로그인 토큰 또는 번호+이름 ----------
  let st: Student | null = null;
  if (typeof body.jwt === "string" && body.jwt) {
    const g = await whoIs(body.jwt);
    if (!g) return json({ error: "session_expired" }, 401, origin);
    const acc = await findAcc(g);
    if (!acc || acc.status !== "approved") return json({ error: "not_approved" }, 403, origin);
    const { data: s } = await sb.from("gt_students").select("id,number,class_id,gt_classes!inner(active)")
      .eq("id", acc.student_id).eq("gt_classes.active", true).maybeSingle();
    st = (s as Student) ?? null;
    if (!st) return json({ error: "no_student" }, 403, origin);
  } else {
    if (!ALLOW_NAME_LOGIN) return json({ error: "login_required" }, 401, origin);
    const num = Number(body.number);
    const key = nameKey(body.name);
    if (!Number.isInteger(num) || num < 1 || num > 60 || !key) return json({ error: "not_found" }, 401, origin);
    const { data: found } = await sb.from("gt_students").select("id,number,class_id,gt_classes!inner(active)")
      .eq("number", num).eq("name_key", key).eq("gt_classes.active", true).limit(1);
    st = (found?.[0] as Student) ?? null;
    if (!st) {
      await sb.from("gt_auth_failures").insert({ ip });
      return json({ error: "not_found" }, 401, origin);
    }
  }
  if (action === "hello") return json({ ok: true, number: st.number, sid: String(st.id).slice(0, 8) }, 200, origin);

  const step = String(body.step ?? "");
  const answer = body.answer;
  const clientId = typeof body.client_id === "string" && /^[0-9a-f-]{36}$/i.test(body.client_id) ? body.client_id : null;
  const flags = Array.isArray(body.flags) ? body.flags.map((x: unknown) => String(x).slice(0, 120)).slice(0, 10) : [];
  if (!STEPS.includes(step)) return json({ error: "bad_step" }, 400, origin);
  if (!answer || typeof answer !== "object" || JSON.stringify(answer).length > 4000) return json({ error: "bad_answer" }, 400, origin);

  const { count: prevCount } = await sb.from("gt_submissions").select("id", { count: "exact", head: true })
    .eq("student_id", st.id).eq("step", step);
  const attempt = (prevCount ?? 0) + 1;

  const { data: sub, error: subErr } = await sb.from("gt_submissions")
    .insert({ student_id: st.id, step, attempt, answer, flags, is_final: action === "final", client_id: clientId })
    .select("id").single();
  if (subErr) {
    if (subErr.code === "23505") return json({ saved: true, duplicate: true }, 200, origin);
    return json({ error: "save_failed" }, 500, origin);
  }
  if (action === "final") return json({ saved: true, attempt }, 200, origin);

  // 활동별 횟수 제한(성공한 AI 도움만 센다)
  const { count: used } = await sb.from("gt_feedbacks")
    .select("id, gt_submissions!inner(student_id, step)", { count: "exact", head: true })
    .eq("gt_submissions.student_id", st.id).eq("gt_submissions.step", step).eq("status", "ok");
  if ((used ?? 0) >= MAX_FEEDBACK) {
    await sb.from("gt_feedbacks").insert({ submission_id: sub.id, status: "limited" });
    return json({ saved: true, attempt, limited: "step", remaining: 0 }, 200, origin);
  }
  // 학급별 하루 상한
  const { data: okCap } = await sb.rpc("gt_bump_ai_usage", { p_class: st.class_id, p_cap: DAILY_CAP });
  if (okCap === false) {
    await sb.from("gt_feedbacks").insert({ submission_id: sub.id, status: "limited", text: "daily cap" });
    return json({ saved: true, attempt, limited: "daily", remaining: Math.max(0, MAX_FEEDBACK - (used ?? 0)) }, 200, origin);
  }

  const { data: ps } = await sb.from("gt_prompts").select("step,body,version").in("step", ["common", step]);
  const common = ps?.find((p) => p.step === "common");
  const own = ps?.find((p) => p.step === step);
  const system = [common?.body ?? "", own?.body ?? ""].filter(Boolean).join("\n\n");
  const version = own?.version ?? common?.version ?? 0;
  const userMsg = `활동: ${step}\n<answer>\n${JSON.stringify(redact(answer))}\n</answer>`;

  const t0 = Date.now();
  try {
    const out = await callLLM(system, userMsg);
    const text = clean(out.text);
    if (!text) throw new Error("빈 응답");
    await sb.from("gt_feedbacks").insert({
      submission_id: sub.id, provider: out.provider, model: out.model, prompt_version: version,
      text, status: "ok", latency_ms: Date.now() - t0,
    });
    return json({ saved: true, attempt, feedback: text, remaining: Math.max(0, MAX_FEEDBACK - (used ?? 0) - 1) }, 200, origin);
  } catch (e) {
    await sb.from("gt_feedbacks").insert({
      submission_id: sub.id, prompt_version: version, text: String((e as Error).message).slice(0, 200),
      status: "error", latency_ms: Date.now() - t0,
    });
    return json({ saved: true, attempt, error: "ai_unavailable", remaining: Math.max(0, MAX_FEEDBACK - (used ?? 0)) }, 200, origin);
  }
});
