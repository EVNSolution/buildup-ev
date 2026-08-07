# 계약서 양식 바꾸는 법

`contract-template.docx` 는 특장 매매계약서 양식이다. 이 파일 하나만 고치면 시스템이
만드는 계약서가 바뀐다. 코드는 건드릴 필요 없다.

## 1. 연다

```bash
open -a LibreOffice doc-templates/contract-template.docx
```

**Word 말고 LibreOffice 로 연다.** 서버가 LibreOffice 로 PDF 를 만들기 때문에,
LibreOffice 화면이 곧 실제 출력이다. 폰트도 서버와 같은 Noto Sans CJK KR 로 맞춰뒀다.

## 2. 고친다

`{{buyer_name}}` 같은 이중중괄호가 값이 들어가는 자리다. 서식(폰트·크기·색·테두리)은
자유롭게 바꿔도 되지만, **토큰 글자 자체는 건드리지 않는다.** 위치를 옮겨야 하면
통째로 지우고 처음부터 다시 타이핑한다. 중간에 커서를 넣고 고치면 쪼개질 수 있다.

토큰 이름을 새로 만들거나 지우려면 코드도 같이 바꿔야 한다. 검증기가 알려준다.

### 자주 쓰는 메뉴 (영문 UI 기준)

| 하고 싶은 것 | 메뉴 |
|---|---|
| 표 테두리 | 행/셀 선택 → **Table ▸ Properties… ▸ Borders** → User-defined 에서 변 클릭 |
| 문단 밑줄 | 커서 → **Format ▸ Paragraph… ▸ Borders** |
| 들여쓰기·간격 | **Format ▸ Paragraph… ▸ Indents & Spacing** |
| 화면에만 보이는 회색선 끄기 | **View ▸ Table Boundaries** (인쇄 안 됨) |
| 빈 문단·페이지나눔 보기 | **View ▸ Formatting Marks** (⌘F10) |

테두리 미리보기에서 변을 클릭하면 **선 있음 → 회색 → 선 없음** 으로 순환한다.
회색은 "그대로 두기" 라 지운 게 아니다. 하얘질 때까지 클릭한다.

⚠️ 들여쓰기는 **눈금자를 끌지 말고 숫자로 입력**한다. 끌면 글자 단위 값이 생겨
Word 와 LibreOffice 가 다르게 해석한다.

## 3. 저장한다

**File ▸ Save** → 대화상자에서 **「Use Word 2010–365 Document Format」**.
ODF 를 고르면 시스템이 못 읽는다.

## 4. 검증한다

```bash
npm run contract:verify
```

「통과」가 나오면 배포해도 된다. 「실패」면 무엇이 문제인지 알려준다.

검사 항목:

| 검사 | 왜 |
|---|---|
| docx 형식 | ODF 로 저장하면 계약서 생성이 통째로 실패한다 |
| 토큰 27개 | 오타 나면 그 칸은 영원히 공란인데 화면엔 아무 표시가 없다 |
| 미치환 토큰 | 값이 안 들어간 자리가 있는지 |
| 빈 페이지 | 여백 문단이 넘치거나 섹션이 「새 페이지에서 시작」이면 백지가 낀다 |
| 계약조항 위치 | 반드시 새 페이지 첫 줄에서 시작해야 한다 |

미리보기 이미지가 필요하면:

```bash
npm run contract:verify -- --preview
```

`.local-doc-storage/contract-preview.png` 에 1페이지가 저장된다.

## 5. 배포한다

커밋 → push → PR 머지하면 자동 배포된다. Claude 에게 "양식 배포해" 라고 해도 된다.

## 자주 나는 사고

**계약조항이 1페이지로 올라옴** — 페이지 나눔이 사라진 것. LibreOffice 는 이 설정을
빈 문단 속 줄바꿈 개체로 저장할 때가 있어서, 그 문단을 지우면 같이 없어진다.
계약조항 줄에 커서를 놓고 **Format ▸ Paragraph ▸ Text Flow ▸ Breaks** 에서
"Insert / Page / Before" 를 다시 켠다.

**백지 페이지가 낀다** — ⌘F10 으로 서식 기호를 켜고 계약조항 앞뒤의 빈 문단을 지운다.
그래도 남으면 문서 끝 섹션이 「새 페이지에서 시작」일 수 있다.

**Word 에서 보던 것과 PDF 가 다르다** — Word 로 열지 말 것. 굳이 열었다면 저장하지 말고
닫는다. Word 는 저장할 때 글자 단위 들여쓰기를 다시 만들어 넣는다.
