const express = require('express');
const router = express.Router();

const Notification = require('../Model/Notification');
const { verifyFirebaseIdToken } = require('../middleware/authFirebase');
const { unauthorized } = require('../utils/httpErrors');

const { pick, randInt, fakeDateWithinLastMonths, uniqueId } = require('../seed/utils');

function getNotificationTypeRoll() {
  // Weighted towards application/internship.
  const r = Math.random();
  if (r < 0.28) return 'application';
  if (r < 0.52) return 'internship';
  if (r < 0.68) return 'announcement';
  if (r < 0.82) return 'social';
  return 'admin';
}

function generateRealisticNotificationsForUser(userId) {
  const sample = [
    'Your internship application has been shortlisted.',
    'New internship matching your profile is live.',
    'Admin announcement: Weekly hiring drive starts tomorrow.',
    'Someone liked your Public Space post.',
    'New comment on your Public Space post.',
    'Company viewed your profile.',
    'Interview scheduled for your application.',
    'Your application status updated to shortlisted.',
    'Career tip: Optimize your resume for ATS scoring.',
    'Public Space: Welcome! Start your first discussion post.',
    'Reminder: Profile completion increases matching accuracy.',
    'Internship deadline is approaching. Apply soon!',
    'Weekly recommendations: Internships you might like.',
    'Application status updated: accepted.',
    'Resume downloaded (your resume was viewed by recruiters).',
  ];

  const titles = [
    'Update from Internshala',
    'New Opportunity',
    'Admin Announcement',
    'Social Notification',
    'Application Status',
    'Profile Reminder',
    'Interview Update',
    'Weekly Highlights',
    'Deadline Alert',
  ];

  const count = randInt(12, 15);
  const chosen = sample.sort(() => Math.random() - 0.5).slice(0, count);

  return chosen.map((message, idx) => {
    const type = getNotificationTypeRoll();
    return {
      userId,
      title: pick(titles),
      message,
      type,
      read: idx < 6 ? false : true, // seed with some unread
      createdAt: fakeDateWithinLastMonths(6),
      _seedId: uniqueId('n_'),
    };
  });
}

// Ensure seeded notifications exist per user.
async function ensureSeeded(userId) {
  const existingCount = await Notification.countDocuments({ userId });
  if (existingCount > 0) return;

  const docs = generateRealisticNotificationsForUser(userId);
  // Don’t persist _seedId
  await Notification.insertMany(
    docs.map(({ _seedId, ...rest }) => rest),
    { ordered: false }
  );
}

// GET: list notifications (scalable: support pagination later)
router.get('/', verifyFirebaseIdToken, async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) throw unauthorized('Unauthorized');

  try {
    await ensureSeeded(userId);

    const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
    const unreadOnly = String(req.query.unreadOnly || 'false') === 'true';

    const query = { userId };
    if (unreadOnly) query.read = false;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      notifications: notifications.map((n) => ({
        id: String(n._id),
        title: n.title,
        message: n.message,
        type: n.type,
        read: n.read,
        createdAt: n.createdAt,
        userId: n.userId,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET: unread count
router.get('/unread-count', verifyFirebaseIdToken, async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) throw unauthorized('Unauthorized');
  try {
    const unreadCount = await Notification.countDocuments({ userId, read: false });
    res.json({ unreadCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// POST: mark notification read
router.post('/:id/read', verifyFirebaseIdToken, async (req, res) => {
  const userId = req.user?.uid;
  if (!userId) throw unauthorized('Unauthorized');
  try {
    const { id } = req.params;

    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { $set: { read: true } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'notification not found' });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;

