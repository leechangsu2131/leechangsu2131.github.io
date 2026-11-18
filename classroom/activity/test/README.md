# 수업 활동 시험 (가짜 서버)

실제 Supabase 없이, 가짜 서버 응답으로 교사·학생 화면을 Playwright 로 시험합니다. 71개 확인.

실행 (저장소 맨 위 폴더에서):
```
python3 -m http.server 8766 &
NODE_PATH=$(npm root -g) node classroom/activity/test/test_activity.cjs
```
- 모두 `PASS` 면 정상. `FAIL` 이 있으면 종료 코드 1.
- 마지막 시험(새 버전 안내)이 `student-activity.js` 의 수정 시각을 1시간 뒤로 바꿉니다(내용은 그대로).
- 실제 DB·배포 주소는 확인하지 못하므로, 수업방 기기에서 직접 보는 확인은 따로 필요합니다.
