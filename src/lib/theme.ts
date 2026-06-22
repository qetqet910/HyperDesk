export type Theme = "dark" | "light" | "retro";

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    // retro uses the light window frame but paints its own teal canvas.
    win.setTheme(theme === "light" ? "light" : "dark").catch(() => {});
    const bg =
      theme === "light" ? { red: 245, green: 247, blue: 250, alpha: 255 }
      : theme === "retro" ? { red: 0, green: 128, blue: 128, alpha: 255 }
      : { red: 15, green: 16, blue: 21, alpha: 255 };
    (win as any).setBackground?.(bg)?.catch?.(() => {});
  }).catch(() => {});
}
