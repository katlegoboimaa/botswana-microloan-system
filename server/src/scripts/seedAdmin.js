import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

await mongoose.connect(process.env.MONGODB_URI);
const email = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const password = String(process.env.ADMIN_PASSWORD || '');
if (!email || password.length < 12 || password === 'ChangeThisStrongPassword123!') {
  console.error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (at least 12 characters) in .env before seeding.');
  process.exit(1);
}
const exists = await User.findOne({ email });
if (exists) {
  console.log('An account with ADMIN_EMAIL already exists; no changes made.');
} else {
  await User.create({
    name: process.env.ADMIN_NAME || 'System Administrator',
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'ADMIN',
    active: true,
    mustChangePassword: true
  });
  console.log(`Administrator created: ${email}`);
}
await mongoose.disconnect();
