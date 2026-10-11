# Current Scope: 20261007-182420-7f6d (P2 thread)

**Created**: 2026-10-11
**Seed**: docs/harness/seed.yaml (task_id 20261007-182420-7f6d, v6)
**Thread-ID**: T-20261011141248-d526
**Thread**: Vercel 배포 기록 보관

이번 반복은 배포 기록 보관용 AC11–AC13만 검증합니다. AC1–AC10의 기존 구현·수락 이력은 유지하며 앱을 재구현하거나 기존 장비 시험 범위를 바꾸지 않습니다.

검증 근거는 `git check-ignore -v`, 추적 파일·아카이브 검사, 수정된 한국어·영어 README와 `docs/harness/verification-report.md` 대조, 공개/로컬 사이트 HTTP 응답 및 변경 경로 확인입니다. 커밋·푸시 결과는 커밋 전에 체크할 수 없으므로 후속 완료 검증으로 분리합니다.

## Acceptance Criteria
- [x] AC11: Vercel 로컬 설정 .vercel 및 .env*는 git check-ignore로 제외됨을 확인하고, 인증 관련 파일·원본 XLSX·로컬 아카이브가 Git 추적 대상에 포함되지 않습니다.
- [x] AC12: 한국어·영어 README와 검증 보고서는 실제 production URL, 비업무용 Hobby 사용, 수동 prebuilt 배포, 자동 Git 배포 비활성화 및 origin별 기록 분리 안내를 일치시킵니다.
- [x] AC13: 배포 기록 보관 변경은 문서·ignore 설정과 필요한 작업 추적 기록으로 한정하며 앱 소스·하네스 코드·배포 설정을 변경하거나 사이트를 재배포하지 않습니다. 새 비프음 사람 청취와 물리 스캐너 미검증 범위를 유지합니다.
