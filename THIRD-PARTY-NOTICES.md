# Third-Party Notices

HyperDesk는 아래의 오픈소스 구성요소를 사용합니다. 모두 MIT / Apache-2.0 /
ISC 등 permissive 라이선스로, 상용 소프트웨어에 포함하여 배포하는 것이
허용되지만 각 라이선스가 요구하는 저작권 고지 의무는 유지되어야 합니다.

> ⚠️ 이 목록은 `package.json` / `Cargo.toml`의 **직접 의존성** 기준 수기
> 작성본입니다. 전이 의존성(transitive dependencies)까지 정확히 포함하려면
> 릴리즈 파이프라인에 `cargo-license`(Rust)와 `license-checker`(npm) 같은
> 자동화 도구를 추가해 빌드마다 생성하는 것을 권장합니다. 법적 검토 시에는
> 자동 생성된 전체 목록을 사용하세요.

## Rust (src-tauri)

| 패키지 | 라이선스 |
|---|---|
| tauri | MIT OR Apache-2.0 |
| tauri-plugin-opener | MIT OR Apache-2.0 |
| tauri-plugin-global-shortcut | MIT OR Apache-2.0 |
| serde / serde_json | MIT OR Apache-2.0 |
| uuid | MIT OR Apache-2.0 |
| tokio | MIT |
| winreg | MIT |
| lazy_static | MIT OR Apache-2.0 |
| windows (windows-rs, Microsoft) | MIT OR Apache-2.0 |
| sysinfo | MIT |
| futures | MIT OR Apache-2.0 |

## JavaScript / TypeScript (package.json)

| 패키지 | 라이선스 |
|---|---|
| react / react-dom | MIT |
| @tauri-apps/api / @tauri-apps/plugin-opener | MIT OR Apache-2.0 |
| @tanstack/react-query | MIT |
| fuse.js | Apache-2.0 |
| lucide-react | ISC |
| framer-motion | MIT |
| recharts | MIT |
| sharp (빌드 타임 전용, 런타임 미배포) | Apache-2.0 |

## 폰트 (자체 호스팅, `src/fonts/`)

| 폰트 | 제작사 | 라이선스 |
|---|---|---|
| 펴진고딕 (Pyeojin Gothic) | 서지환 (엔파피) | SIL Open Font License 1.1 |

OFL 1.1로 임베딩·번들·수정·재배포가 명시적으로 허용된다(글꼴 파일 자체의 유료
판매만 금지). noonnu의 jsDelivr 배포본(woff2)을 self-host 한다 — CSP `font-src`가
`'self'`만 허용하므로 런타임 CDN 로딩은 애초에 불가능(App.css 로딩 애니메이션
트러블슈팅 항목 참고). 웹폰트
CDN(예: Google Fonts)에서 런타임에 불러오지 않고 정적 파일을 빌드에 포함해
자체 호스팅한다 — CSP `connect-src`가 외부 폰트 CDN을 막고 있어(App.css 로딩
애니메이션 트러블슈팅 항목 참고) 애초에 런타임 fetch 방식은 이 앱에서 동작하지
않는다.

## 상표 고지

HyperDesk는 다음 제3자 제품과 상호 연동하지만, 해당 회사들과 제휴/제휴
관계가 없으며 공식 파트너십을 주장하지 않습니다.

- Microsoft, Hyper-V, Windows, RDP(원격 데스크톱)는 Microsoft Corporation의
  상표입니다.
- VMware, VMware Horizon은 Broadcom Inc.(VMware)의 상표입니다.
- Omnissa, Omnissa Horizon은 Omnissa, LLC의 상표입니다.

위 상표의 소유권은 각 권리자에게 있으며, HyperDesk 제품명·마케팅 자료에서
"공식 지원" 또는 "제휴" 등으로 오인될 수 있는 표현은 사용하지 않습니다.
