# Kickoff Plan Attack: jaegosilsa

- Task ID: 20261007-182420-7f6d
- Reviewed by: 독립 reviewer 세션 KickoffPlanAttack
- Review type: 읽기 전용 kickoff 계획 검토. 구현 코드의 3-pass 리뷰가 아니다. 특정 critic 모델·다른 모델 계열 실행을 주장하지 않는다.
- Run count: 1
- Original result: WARN
- Findings: MEDIUM 2, CRITICAL 0
- User-information blockers: 없음
- Integration timestamp: 2026-10-07T18:34:09.059Z
- Resolution: 두 지적 모두 AC1/AC2에 반영했다. 계획 단계의 남은 차단 사항은 없으며 앱·스캐너·음성의 실행 검증은 하지 않았다.

## Finding 1 — 기준 재고 열 선택 검증

샘플의 현매장·창고 값은 전 행 같으므로 샘플만으로 잘못된 열 선택을 구별할 수 없다. 지적 근거는 seed AC1 및 kickoff-summary.md의 Sample Evidence다.

조치: seed.yaml:14, current-scope.md:40, kickoff-summary.md:78의 AC1에 현매장 2·창고 7·타 매장 11의 기준은 2라는 검증 사례를 추가했다. 원본 엑셀은 수정하지 않았다. 이는 합의한 현매장 단일 기준의 검증 구체화이며 새 기능이 아니다.

## Finding 2 — 품번 정규식의 일관성

요약의 정규식에는 영문 대문자로 시작하는 제약이 있지만 초기 seed AC2 산문에는 정확한 정규식이 없었다. 지적 근거는 seed AC2 및 요약 Input Contract다.

조치: seed.yaml:15, current-scope.md:41, kickoff-summary.md:79에 `^([A-Z][A-Z0-9]*[0-9][A-Z0-9]*)\s+(.+)$`와 상품명 외곽 공백 처리·원문 보존을 명시했다. 짧은 X1SHU 지원을 유지하고 최소 길이 제약은 넣지 않았다.

## 구현 후 검증 항목

- 전체 62,080행의 브라우저 가져오기·집계·저장·복원·내보내기.
- 실제 PC 스캐너의 바코드 값과 Enter/Tab 입력 종료 신호.
- 미등록 스캔 시 실제 한국어 오류 음성 청취 및 수량 불변.
- 결과 XLSX를 앱 외부에서 재열어 바코드 문자열·옵션·예외 상품·부호를 확인.

## Verification boundary

리뷰는 명세를 대상으로 했다. 앱이 없는 현 단계에서 실제 실사 동작을 PASS로 판정하지 않았다.
