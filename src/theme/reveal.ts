export interface RevealOrigin {
  x: number;
  y: number;
}
export function circleGeometry(point: RevealOrigin, width: number, height: number) {
  const x = Math.min(Math.max(point.x, 0), width);
  const y = Math.min(Math.max(point.y, 0), height);
  return { x, y, radius: Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) + 2 };
}
export function elementCenter(element: HTMLElement): RevealOrigin {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

let generation = 0;
let active: ViewTransition | undefined;
let animation: Animation | undefined;

/** Old pixels remain untouched outside the expanding new root snapshot, in BOTH directions. */
export async function revealTheme(commit: () => void, point: RevealOrigin) {
  const ticket = ++generation;
  active?.skipTransition();
  animation?.cancel();
  const root = document.documentElement;
  let committed = false;
  const update = () => {
    if (ticket !== generation || committed) return;
    committed = true;
    commit();
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || typeof document.startViewTransition !== 'function' || typeof root.animate !== 'function') {
    delete root.dataset.themeTransition;
    root.style.removeProperty('--theme-reveal-x');
    root.style.removeProperty('--theme-reveal-y');
    active = undefined;
    animation = undefined;
    update(); // No cloned DOM, duplicated form state, or blocking overlay as a fallback.
    return;
  }
  // Settle route entrance before snapshotting, without touching inputs or remounting content.
  document
    .getElementById('main')
    ?.getAnimations()
    .forEach(a => a.finish());
  const entranceNames = new Set([
    'content-arrive',
    'tile-arrive',
    'dialog-arrive',
    'backdrop-arrive',
    'mode-symbol-in'
  ]);
  document.getAnimations().forEach(a => {
    if ('animationName' in a && entranceNames.has(String(a.animationName))) a.finish();
  });
  const { x, y, radius } = circleGeometry(point, innerWidth, innerHeight);
  root.dataset.themeTransition = 'reveal';
  root.style.setProperty('--theme-reveal-x', `${x}px`);
  root.style.setProperty('--theme-reveal-y', `${y}px`);
  let transition: ViewTransition | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    transition = document.startViewTransition(update);
    active = transition;
    // Install a rejection handler immediately, even if ready rejects on a hidden document.
    const finished = transition.finished.catch(() => {});
    await transition.ready;
    if (ticket !== generation) {
      transition.skipTransition();
      return;
    }
    animation = root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      {
        duration: 680,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        pseudoElement: '::view-transition-new(root)',
        fill: 'forwards'
      }
    );
    // Some browsers expose snapshots but cannot animate a pseudo-element through WAAPI.
    if (
      !(animation.effect instanceof KeyframeEffect) ||
      animation.effect.pseudoElement !== '::view-transition-new(root)'
    ) {
      animation.cancel();
      transition.skipTransition();
      await finished;
      return;
    }
    // WebKit can stall WAAPI animations on view-transition pseudo-elements at t=0,
    // leaving `finished` unsettled. Race a watchdog so the data-theme-transition
    // state (which freezes every transition and animation) is always released.
    const stalled = animation;
    const watchdogBail = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => {
        stalled.cancel();
        transition?.skipTransition();
        reject(new Error('view-transition reveal stalled'));
      }, 980);
    });
    await Promise.race([animation.finished, watchdogBail]);
    await finished;
  } catch {
    transition?.skipTransition();
    update(); // A rejected/unsupported snapshot must never prevent the actual setting change.
  } finally {
    clearTimeout(watchdog);
    if (ticket === generation) {
      delete root.dataset.themeTransition;
      root.style.removeProperty('--theme-reveal-x');
      root.style.removeProperty('--theme-reveal-y');
      active = undefined;
      animation = undefined;
    }
  }
}
