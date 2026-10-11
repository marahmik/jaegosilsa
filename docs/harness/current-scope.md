# Current Scope: 20261007-182420-7f6d (P2 thread)

**Created**: 2026-10-11
**Seed**: docs/harness/seed.yaml (task_id 20261007-182420-7f6d, v10)
**Thread-ID**: T-20261011162754-4f04
**Thread**: Vercel Git 연결 및 리셋 재배포

이번 반복은 사용자 승인된 Git 저장소 연결과 실제 리셋 재배포를 수행합니다. 기존 AC1–AC17은 각 과거 반복의 수락 이력으로 보존하며 앱 기능을 추가 수정하지 않습니다.

커밋 이후 후속 검증은 main 푸시로 생성된 Git-sourced production deployment의 READY·실제 공개 URL·리셋/기록 보존 동작을 확인합니다. 이 결과는 커밋을 선행해야 관측할 수 있으므로 아래 커밋 전 체크박스와 분리합니다.

## Acceptance Criteria
- [x] AC18: 사용자 승인에 따라 marahmik/jaegosilsa를 기존 Vercel 프로젝트에 연결하고 production 브랜치를 main으로 확인합니다. vercel.json의 Git 배포 규칙은 main만 true, 나머지 브랜치는 globstar false로 제한합니다.
- [x] AC19: 배포 소스에는 검증된 전체 리셋 기능이 포함되며 앱 코드·IndexedDB 이름/버전·기존 production 주소를 변경하지 않습니다. 원본 XLSX·환경/인증 파일·로컬 아카이브는 Git에 포함하지 않고 유료 전환·구매를 하지 않습니다.
- [x] AC20: 한국어·영어 배포 문서는 Git 연결과 main 자동 배포, CI와 Vercel 배포의 구분, 필요시 수동 재배포 방법을 일치시킵니다. 실제 READY·공개 리셋·배포 전후 기록 유지의 실행 검증은 커밋 이후 후속 단계로 분리해 수행합니다.
