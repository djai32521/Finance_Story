/**
 * Interactive Chip & Magnetic Button Components (`src/design/components/chip.ts`)
 *
 * Used for Explore category lenses, Ask Your Year sample questions & fallback
 * query builder chips, and replay speed selectors.
 */

import gsap from 'gsap';
import { SPR } from '../motion.js';
import type { Category } from '../../../contracts/data.js';
import { CATEGORY_META, CORE_COLORS } from '../palette.js';

export interface ChipItem {
  id: string;
  label: string;
  swatchColor?: string;
  pressed?: boolean;
  dataAttrName?: string;
}

/**
 * Render HTML markup for a single `.chip` button.
 */
export function renderChipHtml(item: ChipItem): string {
  const attrName = item.dataAttrName ?? 'data-chip';
  const pressed = item.pressed ? 'true' : 'false';
  const swatchHtml = item.swatchColor
    ? `<i style="background:${item.swatchColor};outline:1px solid ${CORE_COLORS.ink}"></i>`
    : '';
  const safeVal = item.id.replace(/"/g, '&quot;');
  return `<button type="button" class="chip mag" ${attrName}="${safeVal}" aria-pressed="${pressed}">${swatchHtml}${item.label}</button>`;
}

/**
 * Render a row of category lens chips ("All" + given categories).
 */
export function renderCategoryChipsHtml(
  categories: readonly Category[],
  activeCategory: Category | '' = ''
): string {
  const allChip = renderChipHtml({
    id: '',
    label: 'All',
    swatchColor: CORE_COLORS.bone,
    pressed: activeCategory === '',
    dataAttrName: 'data-cat',
  });

  const catChips = categories
    .map((cat) => {
      const meta = CATEGORY_META[cat];
      return renderChipHtml({
        id: cat,
        label: meta.label,
        swatchColor: meta.color,
        pressed: activeCategory === cat,
        dataAttrName: 'data-cat',
      });
    })
    .join('');

  return allChip + catChips;
}

/**
 * Attach tactile magnetic pointer-pull feedback to `.mag` buttons inside `root`.
 * Returns a cleanup function that removes the listener.
 */
export function attachMagneticButtons(
  root: Document | HTMLElement = document,
  getStageScale: () => number = () => 1
): () => void {
  const onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    const buttons = Array.from(
      root.querySelectorAll<HTMLElement & { _magActive?: boolean }>('.mag')
    );
    const scale = getStageScale();

    for (const btn of buttons) {
      if (!btn.offsetParent) continue;
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = pe.clientX - cx;
      const dy = pe.clientY - cy;
      const reach = Math.max(rect.width, rect.height) * 0.75 + 30;
      const k = btn.closest('#stage, .stage') ? scale : 1;

      if (Math.abs(dx) < reach && Math.abs(dy) < reach) {
        gsap.to(btn, {
          x: (dx * 0.26) / k,
          y: (dy * 0.26) / k,
          duration: 0.28,
          ease: 'power3.out',
          overwrite: 'auto',
        });
        btn._magActive = true;
      } else if (btn._magActive) {
        btn._magActive = false;
        gsap.to(btn, {
          x: 0,
          y: 0,
          duration: 0.3,
          ease: SPR,
          overwrite: 'auto',
        });
      }
    }
  };

  root.addEventListener('pointermove', onPointerMove);
  return () => root.removeEventListener('pointermove', onPointerMove);
}
