/**
 * Test User Migration Script
 *
 * Creates a dedicated test/demo user account with:
 * - Name: Test
 * - Email: test@test.com
 * - Password: Test@123 (hashed by Firebase Auth — never stored in code)
 * - Role: USER (not admin)
 * - isTestUser: true (internal flag for QA/maintenance)
 * - Highest subscription plan (gold) with all premium entitlements
 *
 * This script uses the application's existing authentication and database
 * architecture. The password is passed via the TEST_PASSWORD environment
 * variable and is hashed by Firebase Auth's secure password hashing.
 *
 * NEVER log or display the password anywhere.
 *
 * Usage:
 *   TEST_PASSWORD=<password> node scripts/create-test-user.js
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

// Load backend modules
const UserProfile = require('../Model/UserProfile');
const Subscription = require('../Model/Subscription');
const { getAuthOrThrow } = require('../config/firebaseAdmin');

const TEST_USER = {
  email: 'test@test.com',
  name: 'Test',
  role: 'user',
  isTestUser: true,
  plan: 'gold',
};

async function main() {
  const password = process.env.TEST_PASSWORD;

  if (!password) {
    console.error('Error: TEST_PASSWORD environment variable is required.');
    console.error('Usage: TEST_PASSWORD=<password> node seed/create-test-user.js');
    process.exit(1);
  }

  // Connect to MongoDB
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.error('Missing DATABASE_URL in environment.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to database:', mongoose.connection.name);

  // Get Firebase Auth
  const auth = getAuthOrThrow();

  // Step 1: Create or recreate Firebase Auth user
  let firebaseUid;
  try {
    // Check if the user already exists
    const existing = await auth.getUserByEmail(TEST_USER.email).catch(() => null);

    if (existing) {
      // User exists — update their password (never log it)
      firebaseUid = existing.uid;
      console.log(`Updating existing Firebase user: ${TEST_USER.email} (uid: ${firebaseUid})`);
      await auth.updateUser(firebaseUid, {
        password: password,
        displayName: TEST_USER.name,
        emailVerified: true,
      });
    } else {
      // Create new Firebase Auth user
      firebaseUid = (await auth.createUser({
        email: TEST_USER.email,
        password: password,
        displayName: TEST_USER.name,
        emailVerified: true,
      })).uid;
      console.log(`Created new Firebase user: ${TEST_USER.email} (uid: ${firebaseUid})`);
    }
  } catch (e) {
    console.error('Firebase user creation/update failed:', e.message);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Step 2: Create or update UserProfile document
  const now = new Date();
  try {
    await UserProfile.findOneAndUpdate(
      { firebaseUid: firebaseUid },
      {
        $set: {
          firebaseUid: firebaseUid,
          name: TEST_USER.name,
          email: TEST_USER.email,
          photo: 'https://placehold.co/160x160/png?text=TU',
          verified: true,
          privacy: 'public',
          skills: [
            'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js',
            'MongoDB', 'Firebase', 'Tailwind CSS', 'REST APIs', 'GraphQL'
          ],
          socialLinks: {},
          friends: [],
          friendCount: 0,
          verifiedLanguages: [],
          isTestUser: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        }
      },
      { upsert: true, new: true }
    );
    console.log(`Profile created/updated for uid: ${firebaseUid}`);
  } catch (e) {
    console.error('Profile creation failed:', e.message);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Step 3: Create or update the highest-tier subscription (gold)
  try {
    const subscriptionEndDate = new Date(now);
    subscriptionEndDate.setFullYear(now.getFullYear() + 10); // 10-year subscription

    await Subscription.findOneAndUpdate(
      { userId: firebaseUid, planKey: TEST_USER.plan },
      {
        $set: {
          userId: firebaseUid,
          planKey: TEST_USER.plan,
          status: 'active',
          startDate: now,
          endDate: subscriptionEndDate,
        }
      },
      { upsert: true, new: true }
    );
    console.log(`Subscription (gold) created/updated for uid: ${firebaseUid}`);
  } catch (e) {
    console.error('Subscription creation failed:', e.message);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('---');
  console.log('Test user setup complete.');
  console.log('Email:', TEST_USER.email);
  console.log('Name:', TEST_USER.name);
  console.log('Role: user');
  console.log('Plan: gold (10-year subscription)');
  console.log('isTestUser: true');
  console.log('---');
  console.log('The user can now log in via the normal login flow.');

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
