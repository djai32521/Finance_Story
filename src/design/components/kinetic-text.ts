/**
 * Kinetic Typography Component (`src/design/components/kinetic-text.ts`)
 *
 * Splits headlines into masked line containers (`.ln`) and individual character
 * spans (`.l`) for staggered 15% spring entry and exit animations.
 */

import gsap from 'gsap';
import { MOTION_TOKENS, SPR, isReducedMotion } from '../motion.js';

export interface SplitTextElement extends HTMLElement {
  _ls?: HTMLElement[];
}

/**
 * Split an element's innerHTML (preserving `<br>` line breaks) into masked `.ln`
 * lines and `.l` character spans. Idempotent: returns cached `.l` spans if already split.
 */
export function splitTextElement(el: HTMLElement): HTMLElement[] {
  const target = el as SplitTextElement;
  if (target._ls) {
    return target._ls;
  }

  const lines = target.innerHTML.split(/<br\s*\/?>/i);
  target.innerHTML = lines
    .map((line) => {
      const decoded = line.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const charsHtml = Array.from(decoded)
        .map((ch) => {
          if (ch === ' ') return '<span class="l">&nbsp;</span>';
          const safe = ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;
          return `<span class="l">${safe}</span>`;
        })
        .join('');
      return `<span class="ln">${charsHtml}</span>`;
    })
    .join('');

  target._ls = Array.from(target.querySelectorAll<HTMLElement>('.l'));
  return target._ls;
}

/**
 * Animate a `.split` headline into view on a GSAP timeline using the 15% damped spring.
 */
export function animateKineticTextIn(
  el: HTMLElement,
  tl: gsap.core.Timeline,
  at = 0,
  options: { stagger?: number; duration?: number; reducedMotion?: boolean } = {}
): void {
  const chars = splitTextElement(el);
  const rm = options.reducedMotion ?? isReducedMotion();
  tl.set(el, { autoAlpha: 1, y: 0 }, at);

  if (rm) {
    tl.set(chars, { yPercent: 0 }, at);
    tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.28 }, at);
    return;
  }

  tl.fromTo(
    chars,
    { yPercent: 115 },
    {
      yPercent: 0,
      duration: options.duration ?? MOTION_TOKENS.spring.settle + 0.06,
      ease: SPR,
      stagger: options.stagger ?? MOTION_TOKENS.st.letter,
    },
    at
  );
}

/**
 * Animate a `.split` headline out of view on a GSAP timeline.
 */
export function animateKineticTextOut(
  el: HTMLElement,
  tl: gsap.core.Timeline,
  at = 0,
  options: { duration?: number; reducedMotion?: boolean } = {}
): void {
  const rm = options.reducedMotion ?? isReducedMotion();
  if (rm) {
    tl.to(el, { autoAlpha: 0, duration: 0.25 }, at);
    return;
  }
  tl.to(
    el,
    {
      autoAlpha: 0,
      y: -8,
      duration: options.duration ?? MOTION_TOKENS.tr.textOut,
      ease: 'power2.in',
    },
    at
  );
}
