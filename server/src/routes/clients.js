import { Router } from 'express';
import Client from '../models/Client.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = q ? { $or: [
    { firstName: new RegExp(escapeRegex(q), 'i') }, { lastName: new RegExp(escapeRegex(q), 'i') },
    { clientNumber: new RegExp(escapeRegex(q), 'i') }, { phone: new RegExp(escapeRegex(q), 'i') },
    { nationalId: new RegExp(escapeRegex(q), 'i') }
  ] } : {};
  res.json(await Client.find(filter).sort({ createdAt: -1 }).limit(500));
});
router.post('/', allowRoles('CLERK','MANAGER','ADMIN'), async (req, res) => {
  const { firstName, lastName, nationalId, phone, email='', address, employment='', notes='' } = req.body;
  if (!firstName || !lastName || !nationalId || !phone || !address) return res.status(400).json({ message: 'First name, last name, national ID, phone and address are required' });
  const client = await Client.create({
    clientNumber: `CL-${Date.now().toString().slice(-8)}`,
    firstName, lastName, nationalId, phone, email, address, employment, notes, createdBy: req.user._id
  });
  await audit(req, 'CLIENT_CREATED', 'Client', client._id, { clientNumber: client.clientNumber });
  res.status(201).json(client);
});
router.patch('/:id', allowRoles('ADMIN'), async (req, res) => {
  const allowed = ['firstName','lastName','nationalId','phone','email','address','employment','notes'];
  const changes = {};
  for (const key of allowed) if (req.body[key] !== undefined) changes[key] = req.body[key];
  const client = await Client.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  await audit(req, 'CLIENT_PROFILE_UPDATED', 'Client', client._id, { changedFields: Object.keys(changes) });
  res.json(client);
});
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export default router;
