import cron from 'node-cron';
import { scanAllRssFeeds } from '../services/rssService';

// Run every Monday at 6am ET — same day as publication suggestions so admin starts week with fresh data
export function startRssCron() {
  cron.schedule('0 6 * * 1', () => {
    console.log('[RssJob] Weekly RSS journalist scan starting...');
    scanAllRssFeeds().catch(err => console.error('[RssJob] Error:', err));
  }, { timezone: 'America/New_York' });

  console.log('[RssJob] Weekly RSS cron scheduled — Mondays at 6am ET');
}
