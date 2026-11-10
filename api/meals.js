// Vercel Serverless Function: /api/meals
// NEIS 인증키는 브라우저에 노출하지 않고 서버에서만 사용합니다.
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
    return res.status(500).json({
      error: "서버 환경변수가 설정되지 않았습니다. NEIS_API_KEY, NEIS_OFFICE_CODE, NEIS_SCHOOL_CODE를 확인하세요."
    });
  }

  const date = String(req.query.date || "").replace(/[^0-9]/g, "");
  if (!/^\d{8}$/.test(date)) {
    return res.status(400).json({ error: "날짜는 YYYYMMDD 형식이어야 합니다." });
  }

  const url = new URL("https://open.neis.go.kr/hub/mealServiceDietInfo");
  url.search = new URLSearchParams({
    KEY: key,
    Type: "json",
    pIndex: "1",
    pSize: "10",
    ATPT_OFCDC_SC_CODE: officeCode,
    SD_SCHUL_CODE: schoolCode,
    MLSV_YMD: date
  }).toString();

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({ error: "나이스 서버 응답 오류", detail: data });
    }

    // NEIS는 결과가 없을 때 RESULT 코드 형태로 응답할 수 있습니다.
    const rows = data?.mealServiceDietInfo?.[1]?.row || [];
    const result = data?.RESULT;
    if (!rows.length && result?.CODE && result.CODE !== "INFO-200") {
      return res.status(200).json({ date, meals: [], message: result.MESSAGE || "등록된 급식 정보가 없습니다." });
    }

    const meals = rows.map((row) => ({
      mealType: row.MMEAL_SC_NM || "",
      menu: (row.DDISH_NM || "")
        .split("<br/>")
        .map((item) => item.replace(/\s*\([^)]*\)\s*/g, "").trim())
        .filter(Boolean),
      rawMenu: row.DDISH_NM || "",
      calories: row.CAL_INFO || "",
      nutrition: row.NTR_INFO || "",
      origin: row.ORPLC_INFO || "",
      date: row.MLSV_YMD || date
    }));

    return res.status(200).json({ date, meals });
  } catch (error) {
    return res.status(502).json({ error: "나이스 급식 정보를 가져오지 못했습니다.", detail: error.message });
  }
}
