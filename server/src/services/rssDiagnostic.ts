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
  orgId: string,
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
      max_tokens: 300,
      thinking: { type: 'adaptive' },
      messages: [{
        role: 'user',
        content: `You are helping a PR team understand why their journalist CRM couldn't find RSS feeds for a publication.

Publication: ${publicationName}
URL: ${publicationUrl}
What happened: ${situationDesc}

Respond with ONLY a JSON object in this exact format (no markdown, no explanation outside the JSON):
{
  "analysis": "1–2 sentences explaining the most likely reason RSS discovery failed. Name the platform if you recognise it (e.g. Beehiiv, Substack, Cloudflare, paywall).",
  "action": "One specific actionable next step for the team. Be concrete — include a URL to try, or say exactly what to do (e.g. 'Add key journalists manually', 'Try https://...', 'Deactivate this publication')."
}`,
      }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const raw = textBlock?.text?.trim() ?? '';

    // Validate it's parseable JSON before storing
    let note = raw;
    try {
      JSON.parse(raw); // will throw if malformed
    } catch {
      // Fallback: wrap plain text in structured format
      note = JSON.stringify({ analysis: raw, action: 'Add journalists from this publication manually.' });
    }

    if (note) {
      await pool.query(
        `UPDATE publications SET rss_status_note = $1 WHERE id = $2 AND org_id = $3`,
        [note, publicationId, orgId]
      );
      console.log(`[RssDiagnostic] ${publicationName}: note saved`);
    }
  } catch (err: any) {
    // Non-fatal — diagnostic note is nice to have, not critical
    console.error(`[RssDiagnostic] Failed for "${publicationName}":`, err.message);
  }
}
