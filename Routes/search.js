const express = require('express');
const router = express.Router();

const Internship = require('../Model/Internship');
const Job = require('../Model/Job');

// NOTE: Company search is derived from job/internship company fields for now.
// This endpoint is a placeholder for scalable text search later.
router.get('/', async (req, res) => {
  const query = String(req.query.query || '').trim();
  if (!query) return res.json({ internships: [], jobs: [], companies: [] });

  try {
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const [internships, jobs] = await Promise.all([
      Internship.find({
        $or: [
          { title: { $regex: re } },
          { company: { $regex: re } },
          { location: { $regex: re } },
          { category: { $regex: re } },
        ],
      }).limit(30).lean(),
      Job.find({
        $or: [
          { title: { $regex: re } },
          { company: { $regex: re } },
          { location: { $regex: re } },
          { category: { $regex: re } },
        ],
      }).limit(30).lean(),
    ]);

    const companies = Array.from(
      new Set([
        ...internships.map((x) => x.company).filter(Boolean),
        ...jobs.map((x) => x.company).filter(Boolean),
      ])
    ).slice(0, 30);

    res.json({ internships, jobs, companies });
  } catch (err) {
    // DB may be unavailable in some deployments. Return empty results so the
    // UI degrades gracefully instead of surfacing 500 on every keystroke.
    console.error('[search] falling back to empty results:', err?.message || err);
    res.json({ internships: [], jobs: [], companies: [] });
  }
});

module.exports = router;

