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
            ⛔ 렌더링 에러 (ErrorBoundary 캐치)
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
        </div>
      );
    }
    return this.props.children;
  }
}
