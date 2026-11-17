# GitHub 공개 준비

## 저장소 구성

이 폴더를 저장소 루트로 사용합니다. 상위 폴더의 다른 프로젝트와 이전 앱은 포함하지 않습니다.

- 공개: src, lib, ui, web, data, test, tools 및 루트 문서·라이선스·버전 정보.
- 제외: build, outputs, runtime, third_party, user, 개인 설정·로그. .gitignore를 적용하세요.
- .gitignore는 이미 추적된 파일을 제거하지 않습니다. 기존 저장소를 사용할 경우 업로드할 파일 목록도 확인하세요.
- BASE_SNAPSHOT.json과 대사/시작 속도 점검 문서는 개발 기록입니다. 현재 사용법은 README와 사용매뉴얼을 우선합니다.

## 릴리스 준비 순서

1. README·사용매뉴얼·CHANGELOG와 app-info/package/C# 버전이 일치하는지 확인합니다.
2. 자동 테스트와 해당 변경의 실행본 검증을 수행하고 VALIDATION에 기록합니다. 실게임 확인과 모의 검증은 구분합니다.
3. 문서 변경까지 반영한 뒤 빌드·포터블 패키징을 수행합니다. outputs의 기존 ZIP은 문서 수정만으로 갱신되지 않습니다.
4. ZIP CRC·FILES.sha256.json·ZIP 해시를 확인하고 개인 설정·로그·공식 게임 CLI가 없는지 확인합니다.
5. GitHub에 소스를 올리고 배포 버전과 일치하는 태그(예: v0.9.11)의 Release를 작성합니다. 일반 릴리스로 게시하고 필요하면 Latest로 지정합니다.
6. RELEASE_NOTES.md를 설명으로 사용하고 검증한 포터블 ZIP과 .sha256을 첨부합니다. build 폴더 전체나 검증용 runtime을 첨부하지 않습니다.

## 공개 저장소와 출처

- 저장소: https://github.com/Kimtroll84/MobiNote
- 음원 출처와 외부 구성요소 고지는 THIRD_PARTY_NOTICES에 정리합니다.
