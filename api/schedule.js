// Vercel Serverless Function: /api/schedule
// NEIS 학사일정(SchoolSchedule)을 기간별로 조회합니다.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://leechangsu2131.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET 요청만 지원합니다." });
  }

  const key = process.env.NEIS_API_KEY;
  const officeCode = process.env.NEIS_OFFICE_CODE;
  const schoolCode = process.env.NEIS_SCHOOL_CODE;
  if (!key || !officeCode || !schoolCode) {
    return res.status(500).json({ error: "서버 환경변수 NEIS_API_KEY, NEIS_OFFICE_CODE, NEIS_SCHOOL_CODE를 확인하세요." });
  }

  const from = String(req.query.from || "").replace(/[^0-9]/g, "");
  const to = String(req.query.to || "").replace(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to) || from > to) {
    return res.status(400).json({ error: "시작일과 종료일은 YYYYMMDD 형식이어야 합니다." });
  }

  const url = new URL("https://open.neis.go.kr/hub/SchoolSchedule");
  url.search = new URLSearchParams({
    KEY: key, Type: "json", pIndex: "1", pSize: "1000",
    ATPT_OFCDC_SC_CODE: officeCode, SD_SCHUL_CODE: schoolCode,
    AA_FROM_YMD: from, AA_TO_YMD: to
  }).toString();

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: "나이스 서버 응답 오류", detail: data });

    const rows = data?.SchoolSchedule?.[1]?.row || [];
    const grades = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX"];
    const events = rows.map((row) => ({
      date: row.AA_YMD || "",
      name: row.EVENT_NM || "",
      content: row.EVENT_CNTNT || "",
      dayType: row.SBTR_DD_SC_NM || "",
      // 학년별 해당 여부: 인덱스 0 = 1학년
      grades: grades.map((g) => row[`${g}_GRADE_EVENT_YN`] || "")
    })).filter((e) => e.date && e.name);

    const message = events.length ? "" : (data?.RESULT?.MESSAGE || "등록된 학사일정이 없습니다.");
    return res.status(200).json({ from, to, events, message });
  } catch (error) {
    return res.status(502).json({ error: "학사일정을 가져오지 못했습니다.", detail: error.message });
  }
}
