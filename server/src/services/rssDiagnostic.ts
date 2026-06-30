/**
 * rssDiagnostic.ts
 * Uses Claude to generate a plain-English explanation of why RSS discovery
 * failed for a publication, plus a practical recommendation.
 * Results are stored in publications.rssStatusNote.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db';

const client = new Anthropic();

export async function generateRssDiagnosticNote(
  publicationId: number,
  publicationName: string,
  publicationUrl: string,
  context: {
    failureType: 'no_feeds_found' | 'fetch_error' | 'feeds_failed';
    errorMessage?: string;
    feedUrls?: string[];
    httpStatuses?: string; // e.g. "403" or "404"
  }
): Promise<void> {
  try {
    const { failureType, errorMessage, feedUrls, httpStatuses } = context;

    const situationDesc =
      failureType === 'no_feeds_found'
        ? `Auto-discovery successfully fetched the homepage but found no valid RSS feeds after scanning navigation links.`
        : failureType === 'fetch_error'
        ? `Auto-discovery failed to fetch the homepage. Error: ${errorMessage}`
        : `RSS feeds were saved but all failed when tested. Feed URLs tried: ${(feedUrls ?? []).join(', ')}. HTTP status(es) received: ${httpStatuses ?? 'unknown'}.`;

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 200,
      thinking: { type: 'adaptive' },
      messages: [{
        role: 'user',
        content: `You are helping a PR team understand why their journalist CRM couldn't find RSS feeds for a publication.

Publication: ${publicationName}
URL: ${publicationUrl}
What happened: ${situationDesc}

In 1–2 plain-English sentences, explain the most likely reason why RSS discovery failed (e.g. paywalled, newsletter platform, Cloudflare, no public RSS, etc.) and give one specific practical action the team should take instead (e.g. add journalist manually, deactivate publication, try a specific alternative URL). Be concrete — name the platform if you recognise it. Do not use bullet points or headers. Do not start with "I".`,
      }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const note = textBlock?.text?.trim() ?? '';

    if (note) {
      await pool.query(
        `UPDATE publications SET "rssStatusNote" = $1 WHERE id = $2`,
        [note, publicationId]
      );
      console.log(`[RssDiagnostic] ${publicationName}: note saved`);
    }
  } catch (err: any) {
    // Non-fatal — diagnostic note is nice to have, not critical
    console.error(`[RssDiagnostic] Failed for "${publicationName}":`, err.message);
  }
}
