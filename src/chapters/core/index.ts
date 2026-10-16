import type { ChapterModule, ChapterType } from '../../../contracts/index.js';
import { BigOneChapter } from './big-one-chapter.js';
import { GetawayChapter } from './getaway-chapter.js';
import { HeartbeatChapter } from './heartbeat-chapter.js';
import { OneLineChapter } from './one-line-chapter.js';
import { PersonalityChapter } from './personality-chapter.js';
import { PourChapter } from './pour-chapter.js';
import { ShareCardChapter } from './share-card-chapter.js';
import { ShatterChapter } from './shatter-chapter.js';
import { SquaresChapter } from './squares-chapter.js';
import { StreakChapter } from './streak-chapter.js';
import { YourPlaceChapter } from './your-place-chapter.js';

export * from './pour-chapter.js';
export * from './squares-chapter.js';
export * from './your-place-chapter.js';
export * from './streak-chapter.js';
export * from './getaway-chapter.js';
export * from './heartbeat-chapter.js';
export * from './big-one-chapter.js';
export * from './shatter-chapter.js';
export * from './personality-chapter.js';
export * from './one-line-chapter.js';
export * from './share-card-chapter.js';

export function createCoreChapterModule(type: ChapterType): ChapterModule {
  switch (type) {
    case 'pour':
      return new PourChapter();
    case 'year_as_squares':
      return new SquaresChapter();
    case 'your_place':
      return new YourPlaceChapter();
    case 'streak':
      return new StreakChapter();
    case 'getaway':
      return new GetawayChapter();
    case 'heartbeat':
      return new HeartbeatChapter();
    case 'big_one':
      return new BigOneChapter();
    case 'shatter':
      return new ShatterChapter();
    case 'personality':
      return new PersonalityChapter();
    case 'one_line':
      return new OneLineChapter();
    case 'share_card':
      return new ShareCardChapter();
    case 'bespoke':
    default:
      return new StreakChapter();
  }
}
