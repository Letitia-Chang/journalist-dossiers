import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { companyProfileSchema, emptyProfile, formatIssues, loadProfile, saveProfile } from '../lib/companyProfile';

const router = Router();

router.get('/', async (req, res) => {
  const profile = await loadProfile(req.orgId!);
  res.json({ exists: !!profile, profile: profile ?? emptyProfile() });
});

router.put('/', requireRole('owner', 'admin'), async (req, res) => {
  const parsed = companyProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: formatIssues(parsed.error) });
  }
  await saveProfile(req.orgId!, parsed.data);
  res.json({ exists: true, profile: parsed.data });
});

export default router;
