import { useEffect, type RefObject } from "react";

/**
 * Marks a scroll box with `data-more` while there's more below its fold, so CSS can fade the
 * bottom edge (`.scroll-more`). Content cut off by the box's edge (half a system of the chart,
 * half the settings panel) otherwise looks broken rather than scrollable.
 */
export function useScrollMore(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = () => el.toggleAttribute("data-more", el.scrollTop + el.clientHeight < el.scrollHeight - 8);
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
    };
  }, [ref]);
}
