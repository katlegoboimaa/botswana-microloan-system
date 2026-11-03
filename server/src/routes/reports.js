import { Router } from 'express';
import Loan from '../models/Loan.js';
import Client from '../models/Client.js';
import Payment from '../models/Payment.js';
import AuditLog from '../models/AuditLog.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { fromThebe } from '../utils/money.js';
import { outstanding } from '../utils/loan.js';

const router = Router();
router.use(authenticate);
router.get('/summary', allowRoles('MANAGER','ADMIN','MANAGEMENT'), async (req, res) => {
  const loans = await Loan.find({});
  const active = loans.filter(l => l.status === 'DISBURSED');
  const pending = loans.filter(l => l.status === 'PENDING');
  const overdue = active.filter(l => l.dueDate < new Date() && outstanding(l) > 0);
  const payments = await Payment.find({});
  res.json({
    clients: await Client.countDocuments(),
    totalApplications: loans.length,
    pendingApplications: pending.length,
    approvedLoans: loans.filter(l => ['APPROVED','DISBURSED','SETTLED'].includes(l.status)).length,
    rejectedLoans: loans.filter(l => l.status === 'REJECTED').length,
    activeLoans: active.length,
    overdueLoans: overdue.length,
    capitalDisbursedBWP: fromThebe(active.reduce((s,l) => s + l.principal, 0) + loans.filter(l => ['SETTLED'].includes(l.status)).reduce((s,l) => s + l.principal, 0)),
    paymentsCollectedBWP: fromThebe(payments.reduce((s,p) => s + p.amount, 0)),
    outstandingBWP: fromThebe(loans.filter(l => ['DISBURSED'].includes(l.status)).reduce((s,l) => s + outstanding(l), 0))
  });
});
router.get('/loans', allowRoles('MANAGER','ADMIN','MANAGEMENT'), async (req, res) => {
  const loans = await Loan.find({}).populate('client', 'clientNumber firstName lastName phone').sort({ createdAt: -1 });
  res.json(loans.map(l => ({
    loanNumber: l.loanNumber, client: l.client, status: l.status, dueDate: l.dueDate,
    principalBWP: fromThebe(l.principal), interestBWP: fromThebe(l.interest),
    chargesBWP: fromThebe(l.chargesTotal), paymentsBWP: fromThebe(l.paymentsTotal),
    outstandingBWP: fromThebe(outstanding(l)), submittedAt: l.createdAt
  })));
});
router.get('/audit', allowRoles('ADMIN','MANAGEMENT'), async (req, res) => {
  res.json(await AuditLog.find({}).populate('actor', 'name email role').sort({ createdAt: -1 }).limit(500));
});
export default router;
