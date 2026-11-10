// Vercel Serverless Function: /api/timetable
// 초등학교 시간표는 날짜별로 조회하고 서버에서 한 주 단위로 묶어 반환합니다.
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

  const grade = String(req.query.grade || "");
  const className = String(req.query.class || "");
  const from = String(req.query.from || "").replace(/[^0-9]/g, "");
  const to = String(req.query.to || "").replace(/[^0-9]/g, "");
  if (!/^\d+$/.test(grade) || !/^\d+$/.test(className) || !/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) {
    return res.status(400).json({ error: "학년, 반, 시작일, 종료일을 확인하세요." });
  }

  const start = new Date(`${from.slice(0,4)}-${from.slice(4,6)}-${from.slice(6,8)}T12:00:00+09:00`);
  const end = new Date(`${to.slice(0,4)}-${to.slice(4,6)}-${to.slice(6,8)}T12:00:00+09:00`);
  const days = [];
  for (let d = new Date(start); d <= end && days.length < 7; d.setDate(d.getDate() + 1)) {
    days.push(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`);
  }
  if (!days.length || days.length > 7) return res.status(400).json({ error: "조회 기간은 1~7일이어야 합니다." });

  try {
    const results = await Promise.all(days.map(async (date) => {
      const url = new URL("https://open.neis.go.kr/hub/elsTimetable");
      url.search = new URLSearchParams({
        KEY: key, Type: "json", pIndex: "1", pSize: "100",
        ATPT_OFCDC_SC_CODE: officeCode, SD_SCHUL_CODE: schoolCode,
        AY: date.slice(0,4), SEM: Number(date.slice(4,6)) <= 8 && Number(date.slice(4,6)) >= 3 ? "1" : "2",
        ALL_TI_YMD: date, GRADE: grade, CLASS_NM: className
      }).toString();
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) throw new Error(`나이스 시간표 서버 오류 (${response.status})`);
      const rows = data?.elsTimetable?.[1]?.row || [];
      const result = data?.RESULT || data?.elsTimetable?.[0]?.head?.[1]?.RESULT;
      return {
        date,
        lessons: rows.map(row => ({
          period: Number(row.PERIO),
          subject: row.ITRT_CNTNT || "",
          grade: row.GRADE || grade,
          className: row.CLASS_NM || className
        })).filter(x => Number.isFinite(x.period)).sort((a,b) => a.period-b.period),
        message: rows.length ? "" : (result?.MESSAGE || "등록된 시간표가 없습니다.")
      };
    }));
    return res.status(200).json({ grade, className, from, to, days: results });
  } catch (error) {
    return res.status(502).json({ error: "시간표를 불러오지 못했습니다.", detail: error.message });
  }
}
