import { useEffect, useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';

/** Animate the existing main node, not a keyed Routes tree: forms and drafts stay mounted. */
export function usePageMotion(main: RefObject<HTMLElement | null>, pathname: string) {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    if (!main.current || media.matches || !main.current.animate) return;
    const compact = matchMedia('(max-width: 700px)').matches;
    const entrance = main.current.animate(
      [
        {
          opacity: 0,
          transform: `translateY(${compact ? 16 : 24}px) scale(${compact ? '.992' : '.985'})`,
          filter: compact ? 'none' : 'blur(5px)',
          clipPath: `inset(0 0 ${compact ? 10 : 18}px 0 round ${compact ? 16 : 24}px)`
        },
        {
          opacity: 1,
          transform: 'translateY(0) scale(1)',
          filter: compact ? 'none' : 'blur(0)',
          clipPath: 'inset(0 0 0 0 round 0)'
        }
      ],
      { duration: compact ? 420 : 500, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' }
    );
    const cancel = () => entrance.cancel();
    media.addEventListener('change', cancel);
    return () => {
      entrance.cancel();
      media.removeEventListener('change', cancel);
    };
  }, [pathname, main]);
}

/** State-only transitions do not scroll, remount forms, or move focus. */
export function useSwitchMotion(surface: RefObject<HTMLElement | null>, state: string) {
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const node = surface.current;
    if (!node?.animate || media.matches) return;
    const animation = node.animate([
      { opacity: .25, translate: '0 -8px' },
      { opacity: 1, translate: '0 0' }
    ], { duration: 320, easing: 'cubic-bezier(.05,.7,.1,1)' });
    const cancel = () => animation.cancel();
    media.addEventListener('change', cancel);
    return () => { cancel(); media.removeEventListener('change', cancel); };
  }, [surface, state]);
}

/** At most one style update per frame; no React rerenders and no touch/keyboard parallax. */
export function useArtParallax() {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const media = useRef<MediaQueryList | null>(null);
  useEffect(() => {
    media.current = matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)');
    const reset = () => {
      cancelAnimationFrame(frame.current);
      ref.current?.style.removeProperty('--pointer-x');
      ref.current?.style.removeProperty('--pointer-y');
    };
    media.current.addEventListener('change', reset);
    return () => {
      reset();
      media.current?.removeEventListener('change', reset);
    };
  }, []);
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!media.current?.matches || event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1)) * 12;
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1)) * 10;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      ref.current?.style.setProperty('--pointer-x', `${x}px`);
      ref.current?.style.setProperty('--pointer-y', `${y}px`);
    });
  }
  function onPointerLeave() {
    cancelAnimationFrame(frame.current);
    ref.current?.style.removeProperty('--pointer-x');
    ref.current?.style.removeProperty('--pointer-y');
  }
  return { ref, onPointerMove, onPointerLeave };
}
