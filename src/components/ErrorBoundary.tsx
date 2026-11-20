import React from "react";

interface State { error: Error | null; }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: Error): State {
    return { error: e };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "fixed", inset: 0,
          background: "#0c0d12",
          color: "white",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "40px", fontFamily: "monospace"
        }}>
          <div style={{ color: "#f43f5e", fontSize: "18px", marginBottom: "16px" }}>
            ⛔ Something went wrong while rendering
          </div>
          <div style={{
            background: "#1a1a2e", border: "1px solid #333",
            borderRadius: "8px", padding: "20px",
            maxWidth: "700px", width: "100%",
            fontSize: "13px", lineHeight: "1.7",
            color: "#f1f5f9", whiteSpace: "pre-wrap", wordBreak: "break-all"
          }}>
            <b>Message:</b> {this.state.error.message}
            {"\n\n"}
            <b>Stack:</b> {this.state.error.stack}
          </div>
          {/* 복구 경로. 예전엔 스택만 보여 주고 끝이라 앱을 껐다 켜는 것 말고 방법이 없었다.
              이 컴포넌트는 i18n 바깥(main.tsx 최상단)이라 문구를 두 언어로 같이 적는다.
              마지막 버튼은 저장된 화면 설정(localStorage)이 렌더를 깨는 경우용 — 등록한
              자산·메모·태그는 백엔드 파일이라 지워지지 않는다. */}
          <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => this.setState({ error: null })}>다시 시도 / Retry</button>
            <button onClick={() => location.reload()}>새로 고침 / Reload</button>
            <button onClick={() => {
              try { localStorage.removeItem("hyperdesk_settings"); localStorage.removeItem("hd_page"); } catch { /* 무시 */ }
              location.reload();
            }}>화면 설정 초기화 / Reset UI settings</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
