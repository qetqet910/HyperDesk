# UI Design Guidelines

> Source: [16 little UI design tips that make a big impact](https://www.adhamdannaway.com/blog/ui-design/ui-design-tips) — Adham Dannaway  
> 감각이 아닌 **논리 규칙** 기반으로 UI 결정을 내린다.

---

## 1. Layout & Spacing

### 1.1 관련 요소를 여백으로 묶기
- 관련 요소는 가까이, 무관한 요소는 멀리
- 그룹화 우선순위: `Container > Spacing > Shape > Alignment`
- 컨테이너는 가장 강한 단서지만 시각적 노이즈 증가 → 가능하면 여백+정렬로 대체

### 1.2 불필요한 스타일 제거
- 정보 전달에 기여하지 않는 선, 배경, 여백, 애니메이션 제거
- 인지 부하(cognitive load)를 낮추는 게 목표

---

## 2. Consistency

### 2.1 같은 기능 = 같은 형태
- 제품 내부 + 타 서비스와 비교해도 일관성 유지
- 아이콘 스타일 통일: 채워진 형태/외곽선 혼용 금지
  - 채워진 아이콘 → "선택됨" 으로 오해 가능
  - 권장: `2pt stroke + rounded corners` 으로 통일
- 아이콘에 텍스트 레이블 병기 (스크린 리더 대응)

### 2.2 다른 기능 = 다른 형태
- 비인터랙티브 요소가 버튼처럼 보이면 안 됨
- 색상·형태가 인터랙션 여부를 암시함 → 비인터랙티브엔 버튼 스타일 제거

---

## 3. Visual Hierarchy

### 3.1 중요도 순 시각적 강조
- 도구: `크기 / 색상 / 대비 / 간격 / 위치 / 깊이`
- Primary action이 화면에서 가장 두드러져야 함
  - 고대비 배경색 + bold font weight 적용

### 3.2 Squint Test
- 눈을 가늘게 뜨거나 화면을 흐리게 봤을 때도 주요 요소와 화면 목적이 식별되어야 함
- 통과 못 하면 위계 재조정 필요

---

## 4. Colour

### 4.1 색상은 목적 있게
- 흑백 상태에서 시작 → 필요한 곳에만 컬러 추가
- 브랜드 컬러 = **인터랙티브 요소 전용** (링크, 버튼)
- 비인터랙티브 요소(제목, 별점 등)에 브랜드 컬러 사용 금지

### 4.2 색상만으로 상태 구분 금지
- 색각 이상자 대응 필수
- 링크: 파란색 + **밑줄** 병용 (색상 제거 시에도 식별 가능해야 함)
- 상태/의미를 색상 외 시각적 단서로도 전달

---

## 5. Accessibility (WCAG 2.1 AA)

### 5.1 UI 요소 명암비: 3:1 이상
- 대상: 폼 필드, 아이콘, 버튼 등
- 사진 위 아이콘은 배경 이미지 무관하게 고정 배경 추가

### 5.2 텍스트 명암비
| 텍스트 종류 | 최소 명암비 |
|---|---|
| 18px 이하 소본문 | **4.5:1** |
| 18px bold 이상 또는 24px regular 이상 | **3:1** |

- 측정 도구: [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) / [Contrast Figma Plugin](https://www.figma.com/community/plugin/748533339900865323/contrast)

---

## 6. Typography

### 6.1 서체 선택
- **산세리프 단일 서체** 사용 (읽기 쉽고 중립적)
- 세리프는 개성이 강해 맥락에 맞지 않을 수 있음
- 추천: `Inter` (x-height 높음, 소문자 가독성 우수)

### 6.2 x-height
- x-height(소문자 높이)가 큰 서체 선택
- 글자 간격이 충분한 서체 → 소형 텍스트 가독성 향상

### 6.3 대소문자
- **전체 대문자(UPPERCASE) 지양** — 단어 형태 인식 방해
- Sentence case 사용: 첫 단어 + 고유명사만 대문자

### 6.4 폰트 굵기
- **regular + bold 두 가지만** 사용
  - Heading / 강조 → bold
  - 일반 본문 → regular
  - bold가 무거우면 semi-bold 허용
- Thin / Light / Black 등 극단적 굵기는 대형 제목에만 제한적 사용
- Light 굵기는 명암비 기준 충족해도 가독성 떨어질 수 있음

### 6.5 텍스트 정렬
- 본문 → **왼쪽 정렬** (F-패턴 독서 흐름)
- 중앙 정렬: 짧은 제목/한 줄 텍스트에만 허용
- 양쪽 정렬(justify) 금지 — 인지 장애 사용자에게 불리

### 6.6 순수 검정 텍스트 지양
- `#000000` 대신 짙은 회색 사용
- 흰 배경과의 과도한 대비 → 눈 피로 유발
- 중요도 낮은 텍스트는 더 밝은 회색으로 위계 구분

### 6.7 줄 높이 (Line Height)
- 본문 최소 **1.5 (150%)**
- 권장 범위: `1.5 ~ 2.0`

---

## 7. Quick Checklist

```
Layout
  [ ] 관련 요소 간격 좁힘, 무관 요소 간격 넓힘
  [ ] 불필요한 테두리/배경/여백 제거

Consistency
  [ ] 아이콘 스타일 통일 (stroke 방식 단일화)
  [ ] 비인터랙티브 요소에 버튼 스타일 없음

Hierarchy
  [ ] Squint Test 통과
  [ ] Primary action이 가장 눈에 띔

Colour
  [ ] 브랜드 컬러 = 인터랙티브 전용
  [ ] 색상 외 시각 단서 병용 (밑줄, 형태 등)

Accessibility
  [ ] UI 요소 명암비 ≥ 3:1
  [ ] 소본문 명암비 ≥ 4.5:1

Typography
  [ ] 산세리프 단일 서체
  [ ] regular / bold 두 굵기만
  [ ] 본문 왼쪽 정렬
  [ ] 순수 검정(#000) 미사용
  [ ] 줄 높이 ≥ 1.5
  [ ] 전체 대문자 미사용
```
