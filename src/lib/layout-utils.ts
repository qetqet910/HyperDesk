export type LayoutType = "1x1" | "2x2";

export function getSlotCount(layout: LayoutType | string): number {
  switch (layout) {
    case "1x1": return 1;
    case "2x2": return 4;
    default: return 4;
  }
}
