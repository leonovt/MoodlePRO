/** Shared brand palette, matching the colors used in index.html and the logo. */
export const COLORS = {
  orange: "#f7941e",
  orangeLight: "#ffb347",
  orangeDeep: "#c8590a",
  dark: "#1a1107",
  card: "#2c1c0d",
  cream: "#fdf6ec",
  border: "#4a2f15",
};

/** Swaps an element's background between two colors on hover. */
export function addHoverEffect(el, baseBg, hoverBg) {
  el.addEventListener("mouseenter", () => { el.style.background = hoverBg; });
  el.addEventListener("mouseleave", () => { el.style.background = baseBg; });
}
