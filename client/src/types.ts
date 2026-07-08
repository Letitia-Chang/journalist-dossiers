export interface User {
  id: number;
  name: string;
  title: string;
  email: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  company_description?: string;
  target_verticals?: string[];
}

export interface JournalistScore {
  dimensionId: number;
  score: number;
}

export interface Journalist {
  id: number;
  publication_id: number | null;
  name: string;
  email: string;
  twitter: string;
  linkedin: string;
  bio: string;
  beats: string[];
  total_score: number;
  is_favorite: boolean;
  photo_url: string;
  scores: JournalistScore[];
  outreach_status: string;
  created_at: string;
  updated_at: string;
}

export interface ScoringDimension {
  id: number;
  name: string;
  description: string;
  weight: number;
  display_order: number;
}

export interface Article {
  id: number;
  journalist_id: number;
  title: string;
  url: string;
  summary: string;
  published_at: string | null;
  created_at: string;
}

export const OUTREACH_TYPES = ['pitch', 'follow_up', 'response', 'note'] as const;
export const OUTREACH_STATUSES = ['Ready to Pitch', 'Pitched', 'Responded', 'No Response', 'Covered', 'Declined'] as const;

export interface OutreachLog {
  id: number;
  journalist_id: number;
  campaign_id: number | null;
  type: string;
  status: string;
  notes: string;
  logged_at: string;
  logged_by_name?: string;
}

export interface Publication {
  id: number;
  name: string;
  url: string;
  tier: 'A' | 'B' | 'C';
  focus: string;
  notes: string;
  active: boolean;
  rss_url: string;
  rss_status: 'unknown' | 'active' | 'inactive' | 'none';
  rss_status_note?: string;
  health_status: 'unknown' | 'healthy' | 'unreachable';
  last_health_check: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicationFeed {
  id: number;
  feed_url: string;
  feed_label: string;
  feed_type: 'main' | 'category';
  rss_status: 'unknown' | 'active' | 'inactive';
  rss_last_checked: string | null;
  created_at: string;
}

export interface JournalistSuggestion {
  id: number;
  name: string;
  publication_id: number | null;
  publication_name: string | null;
  source_type: 'rss' | 'staffpage';
  source_url: string;
  recent_article_title: string;
  recent_article_url: string;
  recent_article_date: string;
  suggested_beat: string;
  relevance_score: number;       // 0–10
  matched_tags: string;          // JSON string array
  article_count: number;         // articles found for this author
  all_articles: string;          // JSON string: { title, url, date }[]
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface PublicationSuggestion {
  id: number;
  name: string;
  url: string;
  tier: 'A' | 'B' | 'C';
  focus: string;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export const CAMPAIGN_TYPES = ['cold_intro', 'event', 'hackathon', 'founder_promo'] as const;
export type CampaignType = typeof CAMPAIGN_TYPES[number];
export type CampaignStatus = 'draft' | 'active' | 'completed' | 'archived';
export type DraftStatus = 'not_started' | 'ready' | 'sent' | 'failed';

export interface Campaign {
  id: number;
  name: string;
  campaign_type: string;
  brief: string;
  status: CampaignStatus;
  journalist_count: number;
  sent_count: number;
  drafted_count: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignJournalist {
  id: number;
  campaign_id: number;
  journalist_id: number;
  draft_subject: string;
  draft_body: string;
  status: DraftStatus;
  sent_at: string | null;
  gmail_draft_id: string | null;
  // joined journalist fields
  journalist_name: string;
  journalist_email: string;
  journalist_beats: string[];
  publication_name: string | null;
}

export interface CoverageItem {
  id: number;
  title: string;
  url: string;
  notes: string;
  published_at: string | null;
  created_at: string;
  campaign_id: number | null;
  journalist_id: number | null;
  // joined fields (list view only)
  journalist_name?: string | null;
  publication_name?: string | null;
  campaign_name?: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  status: 'pending' | 'accepted' | 'revoked';
  expires_at: string;
  created_at: string;
  link: string;
}

export interface DashboardData {
  totalJournalists: number;
  avgScore: number;
  activeCampaigns: number;
  draftsReady: number;
  sentThisWeek: number;
  recentOutreach: (OutreachLog & { journalist_name: string })[];
  recentCampaigns: { id: number; name: string; campaign_type: string; status: string; journalist_count: number; sent_count: number }[];
  recentCoverage: { id: number; title: string; url: string; published_at: string | null }[];
  warmContacts: { id: number; name: string; total_score: number; outreach_status: string }[];
}
