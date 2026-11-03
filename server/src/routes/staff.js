import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();
router.use(authenticate, allowRoles('ADMIN'));
router.get('/', async (req, res) => {
  res.json(await User.find({}).select('-passwordHash').sort({ createdAt: -1 }));
});
router.post('/', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ message: 'Name, email, temporary password and role are required' });
  if (!['CLERK','MANAGER','ADMIN','MANAGEMENT'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
  if (String(email).toLowerCase() === req.user.email && role !== req.user.role) return res.status(400).json({ message: 'Cannot change your own role' });
  if (String(password).length < 12) return res.status(400).json({ message: 'Temporary password must be at least 12 characters' });
  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role, mustChangePassword: true });
  await audit(req, 'STAFF_ACCOUNT_CREATED', 'User', user._id, { email: user.email, role: user.role });
  res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role, active: user.active });
});
router.patch('/:id', async (req, res) => {
  if (String(req.params.id) === String(req.user._id) && req.body.role && req.body.role !== req.user.role) return res.status(403).json({ message: 'You cannot change your own role' });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'Staff account not found' });
  if (req.body.role !== undefined) {
    if (!['CLERK','MANAGER','ADMIN','MANAGEMENT'].includes(req.body.role)) return res.status(400).json({ message: 'Invalid role' });
    user.role = req.body.role;
  }
  if (req.body.active !== undefined) user.active = Boolean(req.body.active);
  if (req.body.password) {
    if (String(req.body.password).length < 12) return res.status(400).json({ message: 'Password must be at least 12 characters' });
    user.passwordHash = await bcrypt.hash(String(req.body.password), 12);
    user.mustChangePassword = true;
  }
  await user.save();
  await audit(req, 'STAFF_ACCOUNT_UPDATED', 'User', user._id, { role: user.role, active: user.active });
  res.json({ id: user._id, name: user.name, email: user.email, role: user.role, active: user.active });
});
export default router;
