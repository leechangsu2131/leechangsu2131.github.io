// Vercel Serverless Function: /api/school
// NEIS 학교기본정보(schoolInfo)를 조회합니다.
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

  const url = new URL("https://open.neis.go.kr/hub/schoolInfo");
  url.search = new URLSearchParams({
    KEY: key, Type: "json", pIndex: "1", pSize: "5",
    ATPT_OFCDC_SC_CODE: officeCode, SD_SCHUL_CODE: schoolCode
  }).toString();

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: "나이스 서버 응답 오류", detail: data });

    const row = data?.schoolInfo?.[1]?.row?.[0];
    if (!row) return res.status(200).json({ school: null, message: data?.RESULT?.MESSAGE || "학교 정보를 찾지 못했습니다." });

    return res.status(200).json({
      school: {
        name: row.SCHUL_NM || "",
        kind: row.SCHUL_KND_SC_NM || "",
        office: row.ATPT_OFCDC_SC_NM || "",
        supportOffice: row.JU_ORG_NM || "",
        address: [row.ORG_RDNMA, row.ORG_RDNDA].filter(Boolean).join(" ").trim(),
        zip: row.ORG_RDNZC || "",
        tel: row.ORG_TELNO || "",
        fax: row.ORG_FAXNO || "",
        homepage: row.HMPG_ADRES || "",
        founded: row.FOND_YMD || "",
        foundType: row.FOND_SC_NM || "",
        coedu: row.COEDU_SC_NM || ""
      }
    });
  } catch (error) {
    return res.status(502).json({ error: "학교 정보를 가져오지 못했습니다.", detail: error.message });
  }
}
