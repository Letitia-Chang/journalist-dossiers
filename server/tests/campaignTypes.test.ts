import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { campaignTypeName } from '../src/lib/campaignTypes';
import { DEMO_CAMPAIGN } from '../src/demo/seedData';

describe('campaign types', () => {
  it('reach the prompt as plain names, including ones saved before the list changed', () => {
    expect(['product_launch', 'funding', 'hackathon', 'something_else', ''].map(campaignTypeName)).toEqual(['Product launch', 'Funding announcement', 'Hackathon', 'something else', 'General pitch']);
  });
  it('every type the client offers has a name here, and the demo uses one of them', () => {
    const client = fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/campaignTypes.ts'), 'utf8');
    const keys = [...client.split('const RETIRED')[0].matchAll(/^ {2}(\w+): \{$/gm)].map(m => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const k of keys) expect(campaignTypeName(k), k).toMatch(/^[A-Z]/); // unknown keys stay lower-case
    expect(keys).toContain(DEMO_CAMPAIGN.type);
  });
});
