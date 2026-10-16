/**
 * DOM Digit-Strip Odometer Component (`src/design/components/odometer.ts`)
 *
 * Smoothly rolls tabular digit strips to any formatted money or number string
 * and lands on the exact final digits. Uses a 1.18em vertical slot pitch so
 * adjacent digits in the strip never bleed into the visible window at giant display sizes.
 */

import gsap from 'gsap';
import { isReducedMotion } from '../motion.js';

const STRIP_REPEAT_COUNT = 30;
const SLOT_HEIGHT_EM = 1.18;
const DIGITS_30_HTML = Array.from(
  { length: STRIP_REPEAT_COUNT },
  (_, i) => `<i>${i % 10}</i>`
).join('');

export interface OdometerOptions {
  /** Hide leading zeros completely instead of dimming them to 20% opacity */
  hideLeadingZeros?: boolean;
  /** Initial template string (e.g. "00,000" or "$2,184") */
  template?: string;
}

export interface OdometerRollOptions {
  /** Number of full 0–9 revolutions before landing (default: 1) */
  laps?: number;
  /** Roll duration in seconds (default: 0.62) */
  dur?: number;
  /** Base delay in seconds (default: 0) */
  delay?: number;
  /** Per-digit left-to-right stagger in seconds (default: 0.045) */
  stagger?: number;
  /** Override reduced motion check */
  reducedMotion?: boolean;
}

interface DigitSlot {
  wrapper: HTMLSpanElement;
  strip: HTMLSpanElement;
  pos: number;
}

interface SeparatorSlot {
  el: HTMLSpanElement;
  digitIndexBefore: number;
}

export interface OdometerElement extends HTMLElement {
  _odo?: Odometer;
  _o?: Odometer;
}

export class Odometer {
  public readonly el: HTMLElement;
  public tpl = '0';
  public digits: DigitSlot[] = [];
  public separators: SeparatorSlot[] = [];
  public n = 0;

  constructor(el: HTMLElement, template?: string, options: OdometerOptions = {}) {
    this.el = el;
    el.classList.add('odo');
    if (options.hideLeadingZeros || el.dataset.hide === '1') {
      el.classList.add('hide');
    }
    const initialTpl = template ?? options.template ?? el.dataset.v ?? el.textContent ?? '0';
    this.build(initialTpl);

    // If data-v has non-zero digits, initialize to that value immediately so static renders work out of the box
    const rawDigits = (el.dataset.v ?? initialTpl).replace(/\D/g, '');
    if (rawDigits.length > 0 && Number(rawDigits) > 0) {
      this.jump(Number(rawDigits));
    }
  }

  /**
   * Build the DOM digit-strip columns and separator characters from a template string.
   */
  public build(template: string): void {
    this.tpl = template;
    this.el.innerHTML = '';
    this.digits = [];
    this.separators = [];

    for (const ch of template) {
      if (/\d/.test(ch)) {
        const wrapper = document.createElement('span');
        wrapper.className = 'dg';
        const strip = document.createElement('span');
        strip.className = 'st';
        strip.innerHTML = DIGITS_30_HTML;
        wrapper.appendChild(strip);
        this.el.appendChild(wrapper);
        this.digits.push({ wrapper, strip, pos: 0 });
      } else {
        const sep = document.createElement('span');
        sep.className = 'sp';
        sep.textContent = ch;
        this.el.appendChild(sep);
        this.separators.push({ el: sep, digitIndexBefore: this.digits.length });
      }
    }

    this.n = this.digits.length;
    for (let k = 0; k < this.n; k++) {
      this.applyTransform(k);
    }
  }

  private applyTransform(index: number): void {
    const slot = this.digits[index];
    if (!slot) return;
    const offsetEm = (-slot.pos * SLOT_HEIGHT_EM).toFixed(4);
    slot.strip.style.transform = `translate3d(0, ${offsetEm}em, 0)`;
  }

  private updateLeadingZeros(numericValue: number): void {
    const intVal = Math.max(0, Math.floor(Math.abs(numericValue)));
    const str = String(intVal);
    const leadingCount = this.n - str.length;
    this.digits.forEach((slot, k) => {
      slot.wrapper.classList.toggle('z', k < leadingCount && k < this.n - 1);
    });
    this.separators.forEach((sep) => {
      sep.el.classList.toggle('z', sep.digitIndexBefore <= leadingCount);
    });
  }

  /**
   * Set the continuous or integer value immediately (used during continuous sweep or scrubbing).
   */
  public set(value: number, continuous = false): void {
    const safeVal = Math.max(0, value);
    for (let k = 0; k < this.n; k++) {
      const place = this.n - 1 - k;
      const power = Math.pow(10, place);
      const slot = this.digits[k]!;
      gsap.killTweensOf(slot);
      let pos = Math.floor(safeVal / power) % 10;
      if (continuous) {
        if (place === 0) {
          pos = safeVal % 10;
        } else {
          const rem = safeVal % power;
          if (rem > power - 1) {
            pos += rem - (power - 1);
          }
        }
      }
      slot.pos = pos;
      this.applyTransform(k);
    }
    this.updateLeadingZeros(safeVal);
  }

  /**
   * Snap immediately to the exact rounded integer value without animation.
   */
  public jump(value: number): void {
    this.set(Math.round(value), false);
  }

  /**
   * Roll smoothly to the target integer value (or formatted string's digits) and land on exact integers.
   */
  public roll(valueOrFormatted: number | string, options: OdometerRollOptions = {}): void {
    const numeric =
      typeof valueOrFormatted === 'string'
        ? Number(valueOrFormatted.replace(/[^\d.]/g, '')) || 0
        : valueOrFormatted;
    const targetInt = Math.max(0, Math.round(numeric));
    const str = String(targetInt).padStart(this.n, '0').slice(-this.n);
    this.updateLeadingZeros(targetInt);

    const rm = options.reducedMotion ?? isReducedMotion();
    if (rm) {
      this.digits.forEach((slot, k) => {
        gsap.killTweensOf(slot);
        slot.pos = Number(str[k] ?? 0);
        this.applyTransform(k);
      });
      return;
    }

    const laps = options.laps ?? 1;
    const dur = options.dur ?? 0.62;
    const baseDelay = options.delay ?? 0;
    const stagger = options.stagger ?? 0.045;

    this.digits.forEach((slot, k) => {
      const toDigit = Number(str[k] ?? 0);
      const fromDigit = ((slot.pos % 10) + 10) % 10;
      gsap.killTweensOf(slot);
      slot.pos = fromDigit;
      gsap.to(slot, {
        pos: toDigit + 10 * laps,
        duration: dur,
        delay: baseDelay + k * stagger,
        ease: 'power4.out',
        onUpdate: () => this.applyTransform(k),
        onComplete: () => {
          slot.pos = toDigit;
          this.applyTransform(k);
        },
      });
    });
  }

  /**
   * Re-template and roll to a new formatted display string (e.g. "$2,184" -> "2,184").
   */
  public rollToFormatted(formatted: string, options: OdometerRollOptions = {}): void {
    const cleanTpl = formatted.replace(/^\s*(?:US\$|\$)\s*/, '');
    if (cleanTpl.length !== this.tpl.length) {
      this.build(cleanTpl.replace(/\d/g, '0'));
    }
    const rawDigits = cleanTpl.replace(/\D/g, '');
    this.roll(Number(rawDigits || 0), options);
  }
}

/**
 * Initialize all `.od` elements inside `root` as `Odometer` instances.
 */
export function initOdometers(root: ParentNode = document): Odometer[] {
  const elements = Array.from(root.querySelectorAll<OdometerElement>('.od'));
  return elements.map((el) => {
    if (!el._odo) {
      const rawVal = el.dataset.v ?? el.textContent ?? '0';
      const tpl = rawVal.replace(/\d/g, '0');
      const instance = new Odometer(el, tpl, {
        hideLeadingZeros: el.dataset.hide === '1',
      });
      el._odo = instance;
      el._o = instance;
    }
    return el._odo;
  });
}

/**
 * Render HTML markup for a giant display number with optional prefix (`US$`) and suffix (`visits`, `×`) superscripts.
 */
export function renderBigNumberHtml(params: {
  valueFormatted: string;
  sizePx: number;
  prefixSup?: string;
  suffixSup?: string;
  style?: string;
  className?: string;
  hideLeadingZeros?: boolean;
}): string {
  const pre = params.prefixSup ? `<sup>${params.prefixSup}</sup>` : '';
  const aft = params.suffixSup ? `<sup class="aft">${params.suffixSup}</sup>` : '';
  const cls = ['num', 'tx', params.className ?? ''].filter(Boolean).join(' ');
  const styleAttr = `font-size:${params.sizePx}px;${params.style ?? ''}`;
  const hideAttr = params.hideLeadingZeros ? ' data-hide="1"' : '';
  return `<div class="${cls}" style="${styleAttr}">${pre}<span class="od" data-v="${params.valueFormatted}"${hideAttr}>${params.valueFormatted}</span>${aft}</div>`;
}
