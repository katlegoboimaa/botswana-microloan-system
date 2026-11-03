import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  const token = jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
  req.user = user;
  await audit(req, 'LOGIN_SUCCESS', 'User', user._id, {});
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword } });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role, mustChangePassword: req.user.mustChangePassword } });
});

router.post('/change-password', authenticate, async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 12) return res.status(400).json({ message: 'Use at least 12 characters for the new password' });
  const user = await User.findById(req.user._id).select('+passwordHash');
  user.passwordHash = await bcrypt.hash(password, 12);
  user.mustChangePassword = false;
  await user.save();
  await audit(req, 'PASSWORD_CHANGED', 'User', user._id);
  res.json({ message: 'Password updated' });
});

export default router;
