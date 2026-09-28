# Third-Party Notices

HyperDesk는 아래 오픈소스 구성요소를 사용합니다. 모두 MIT, Apache-2.0, ISC, SIL OFL 같은
허용형(permissive) 라이선스이며, 각 라이선스가 요구하는 저작권 고지를 이 문서와 앱의
"오픈소스 라이선스" 화면으로 유지합니다.

아래 목록은 **직접 의존성**만 담았습니다. 간접 의존성까지 포함한 전체 목록은 다음 명령으로
만들 수 있습니다.

```bash
cargo install cargo-license && (cd src-tauri && cargo license)
npx license-checker --production --summary
```

## Rust (`src-tauri/Cargo.toml`)

| 패키지 | 라이선스 |
|---|---|
| tauri | Apache-2.0 OR MIT |
| tauri-plugin-opener | Apache-2.0 OR MIT |
| tauri-plugin-global-shortcut | Apache-2.0 OR MIT |
| tauri-plugin-updater | Apache-2.0 OR MIT |
| tauri-plugin-process | Apache-2.0 OR MIT |
| tauri-plugin-single-instance | Apache-2.0 OR MIT |
| serde, serde_json | MIT OR Apache-2.0 |
| uuid | Apache-2.0 OR MIT |
| tokio | MIT |
| futures | MIT OR Apache-2.0 |
| winreg | MIT |
| windows (windows-rs, Microsoft) | MIT OR Apache-2.0 |
| sysinfo | MIT |

## JavaScript / TypeScript (`package.json`)

| 패키지 | 라이선스 |
|---|---|
| react, react-dom | MIT |
| @tauri-apps/api | Apache-2.0 OR MIT |
| @tauri-apps/plugin-opener, plugin-updater, plugin-process | MIT OR Apache-2.0 |
| @tanstack/react-query | MIT |
| @lottiefiles/dotlottie-react, @lottiefiles/dotlottie-web | MIT |
| framer-motion | MIT |
| recharts | MIT |
| fuse.js | Apache-2.0 |
| lucide-react | ISC |

## 폰트 (`src/fonts/`)

| 폰트 | 제작 | 라이선스 |
|---|---|---|
| 펴진고딕 (Pyeojin Gothic) | 서지환 (엔파피) | SIL Open Font License 1.1 |

앱에 포함해 배포하고, 인터넷에서 불러오지 않습니다. OFL 1.1은 임베딩·번들·재배포를 허용하고
글꼴 파일만 따로 판매하는 것을 금지합니다.

## 애니메이션 (`public/loading.lottie`)

| 항목 | 출처 | 라이선스 |
|---|---|---|
| 로딩 애니메이션 | LottieFiles 무료 애니메이션 | Lottie Simple License |

## 상표

HyperDesk는 아래 제품과 연동하지만 해당 회사들과 제휴하거나 공식 파트너 관계에 있지 않습니다.

- Microsoft, Windows, Hyper-V, 원격 데스크톱(Remote Desktop)은 Microsoft Corporation의 상표입니다.
- VMware, VMware Horizon은 Broadcom Inc.의 상표입니다.
- Omnissa, Omnissa Horizon은 Omnissa, LLC의 상표입니다.
