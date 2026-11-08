import { useLayoutEffect, useRef, type ReactNode } from "react";

// A Family Board card's contents follow the size the member gives the card.
// The surface is laid out at a width of (card width / scale) and then scaled,
// and the scale is the largest one at which everything still fits inside the
// card. A bigger card therefore shows bigger content and a smaller card smaller
// content, and the layout re-flows instead of being squashed like a picture.

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 6;
const SEARCH_STEPS = 14;

// Pure search used by the component and by the tests: the largest scale in
// [MIN_SCALE, MAX_SCALE] at which `heightAt(scale) * scale <= available`, where
// heightAt is the content height when laid out at width (card width / scale).
export function chooseScale(
  available: number,
  heightAt: (scale: number) => number,
): number {
  if (!(available > 0)) return MIN_SCALE;
  if (heightAt(MAX_SCALE) * MAX_SCALE <= available) return MAX_SCALE;
  if (heightAt(MIN_SCALE) * MIN_SCALE > available) return MIN_SCALE;
  let low = MIN_SCALE;
  let high = MAX_SCALE;
  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const mid = (low + high) / 2;
    if (heightAt(mid) * mid <= available) low = mid;
    else high = mid;
  }
  return low;
}

export function FitToCard({ children }: { readonly children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const applied = useRef("");

  useLayoutEffect(() => {
    const hostElement = host.current;
    const innerElement = inner.current;
    if (!hostElement || !innerElement) return;
    let frame = 0;
    // Fitting measures by briefly changing the surface's own style, and that
    // collapses the page's height for a moment. Two consequences are guarded
    // against: (1) the surface must not react to the changes it makes itself
    // (otherwise it re-fits on every frame, forever), and (2) the browser
    // clamps the scroll position when the page shrinks, so the page would be
    // thrown back to the top while the member scrolls on a phone.
    let mutations: MutationObserver;

    const fit = () => {
      frame = 0;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      try {
        fitNow();
      } finally {
        if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
          window.scrollTo(scrollX, scrollY);
        }
        mutations.takeRecords();
      }
    };

    const fitNow = () => {
      const width = hostElement.clientWidth;
      const height = hostElement.clientHeight;
      if (width < 1 || height < 1) return;
      const heightAt = (scale: number) => {
        innerElement.style.width = `${width / scale}px`;
        innerElement.style.minHeight = "0px";
        // Browsers round heights to whole pixels, and scaling magnifies the
        // rounding, so measure one pixel high to keep everything inside.
        // A word wider than the card also counts as not fitting.
        if (innerElement.scrollWidth > innerElement.clientWidth) return Number.POSITIVE_INFINITY;
        return innerElement.scrollHeight + 1;
      };
      const stretched = innerElement.style.minHeight;
      const signature = `${width}x${height}|${heightAt(Number(innerElement.dataset.scale ?? "1"))}`;
      if (signature === applied.current) {
        innerElement.style.minHeight = stretched;
        return;
      }
      const scale = chooseScale(height, heightAt);
      innerElement.style.width = `${width / scale}px`;
      innerElement.style.transform = `scale(${scale})`;
      // Stretch to the full card so a background the surface draws fills it all.
      innerElement.style.minHeight = `${height / scale}px`;
      innerElement.dataset.scale = String(scale);
      applied.current = `${width}x${height}|${innerElement.scrollHeight + 1}`;
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(fit);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(hostElement);
    // Content that loads or changes (a list filling in) changes its height.
    mutations = new MutationObserver(schedule);
    mutations.observe(innerElement, { childList: true, subtree: true, characterData: true, attributes: true });
    fit();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="homi-fit" ref={host}>
      <div className="homi-fit__content" ref={inner}>{children}</div>
    </div>
  );
}
