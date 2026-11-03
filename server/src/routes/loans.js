import { Router } from 'express';
import Loan from '../models/Loan.js';
import Client from '../models/Client.js';
import Payment from '../models/Payment.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { toThebe, fromThebe } from '../utils/money.js';
import { outstanding, remainingComponents, loanSummary } from '../utils/loan.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.client) filter.client = req.query.client;
  const loans = await Loan.find(filter).populate('client', 'clientNumber firstName lastName phone nationalId').populate('submittedBy', 'name role').populate('decidedBy', 'name').sort({ createdAt: -1 }).limit(1000);
  res.json(loans.map(loanSummary));
});

router.post('/', allowRoles('CLERK','MANAGER'), async (req, res) => {
  const { clientId, principal, dueDate, purpose, interestRate = 25 } = req.body;
  if (!clientId || !principal || !dueDate || !purpose) return res.status(400).json({ message: 'Client, principal, due date and purpose are required' });
  const client = await Client.findById(clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });
  const principalThebe = toThebe(principal);
  if (principalThebe <= 0) return res.status(400).json({ message: 'Principal must be greater than zero' });
  const rate = Number(interestRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return res.status(400).json({ message: 'Interest rate must be between 0 and 100 percent' });
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime()) || due <= new Date()) return res.status(400).json({ message: 'Due date must be a valid future date' });
  const interest = Math.round(principalThebe * rate / 100);
  const loan = await Loan.create({
    loanNumber: `LN-${Date.now().toString().slice(-9)}`, client: client._id,
    principal: principalThebe, interestRate: rate, interest, amountDueAtStart: principalThebe + interest,
    dueDate: due, purpose: String(purpose).trim(), submittedBy: req.user._id, status: 'PENDING'
  });
  await audit(req, 'LOAN_APPLICATION_SUBMITTED', 'Loan', loan._id, { loanNumber: loan.loanNumber, principal: fromThebe(principalThebe), interestRate: rate });
  res.status(201).json(loanSummary(loan));
});

router.post('/:id/decision', allowRoles('MANAGER'), async (req, res) => {
  const { decision, note = '' } = req.body;
  if (!['APPROVED','REJECTED'].includes(decision)) return res.status(400).json({ message: 'Decision must be APPROVED or REJECTED' });
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  if (loan.status !== 'PENDING') return res.status(409).json({ message: 'Only pending applications can be decided' });
  if (String(loan.submittedBy) === String(req.user._id)) return res.status(403).json({ message: 'You cannot approve or reject an application you submitted' });
  loan.status = decision;
  loan.decisionNote = String(note).slice(0, 1000);
  loan.decidedBy = req.user._id;
  loan.decidedAt = new Date();
  await loan.save();
  await audit(req, `LOAN_${decision}`, 'Loan', loan._id, { loanNumber: loan.loanNumber, note: loan.decisionNote });
  res.json(loanSummary(loan));
});

router.post('/:id/disburse', allowRoles('MANAGER'), async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  if (loan.status !== 'APPROVED') return res.status(409).json({ message: 'Only approved loans can be disbursed' });
  if (String(loan.decidedBy) === String(req.user._id)) {
    // A different manager should perform disbursement when the same person approved.
    return res.status(403).json({ message: 'For separation of duties, a different manager must record disbursement' });
  }
  loan.status = 'DISBURSED';
  loan.disbursedBy = req.user._id;
  loan.disbursedAt = new Date();
  await loan.save();
  await audit(req, 'LOAN_DISBURSED', 'Loan', loan._id, { loanNumber: loan.loanNumber, principal: fromThebe(loan.principal) });
  res.json(loanSummary(loan));
});

router.post('/:id/repayments', allowRoles('CLERK','MANAGER'), async (req, res) => {
  const { amount, method, reference = '' } = req.body;
  const amountThebe = toThebe(amount);
  if (amountThebe <= 0) return res.status(400).json({ message: 'Payment must be greater than zero' });
  if (!['CASH','BANK_TRANSFER','MOBILE_MONEY','OTHER'].includes(method)) return res.status(400).json({ message: 'Choose a valid payment method' });
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  if (!['DISBURSED','SETTLED'].includes(loan.status)) return res.status(409).json({ message: 'Repayments can only be recorded for a disbursed loan' });
  const balance = outstanding(loan);
  if (balance <= 0 || loan.status === 'SETTLED') return res.status(409).json({ message: 'This loan is already settled' });
  if (amountThebe > balance) return res.status(400).json({ message: `Payment exceeds outstanding balance of BWP ${fromThebe(balance).toFixed(2)}` });
  const left = remainingComponents(loan);
  let remaining = amountThebe;
  const allocatedCharges = Math.min(remaining, left.charges); remaining -= allocatedCharges;
  const allocatedInterest = Math.min(remaining, left.interest); remaining -= allocatedInterest;
  const allocatedPrincipal = Math.min(remaining, left.principal); remaining -= allocatedPrincipal;
  if (remaining > 0) return res.status(409).json({ message: 'Could not allocate payment; refresh the loan and retry' });
  const payment = await Payment.create({
    receiptNumber: `RC-${Date.now()}-${Math.floor(Math.random()*900+100)}`,
    loan: loan._id, client: loan.client, amount: amountThebe, allocatedCharges, allocatedInterest, allocatedPrincipal,
    method, reference: String(reference).slice(0, 150), receivedBy: req.user._id
  });
  loan.paymentsTotal += amountThebe;
  loan.chargesPaid += allocatedCharges;
  loan.interestPaid += allocatedInterest;
  loan.principalPaid += allocatedPrincipal;
  if (outstanding(loan) === 0) { loan.status = 'SETTLED'; loan.settledAt = new Date(); }
  await loan.save();
  await audit(req, 'REPAYMENT_RECORDED', 'Payment', payment._id, { receiptNumber: payment.receiptNumber, loanNumber: loan.loanNumber, amountBWP: fromThebe(amountThebe) });
  res.status(201).json({
    receiptNumber: payment.receiptNumber, receivedAt: payment.receivedAt, amountBWP: fromThebe(payment.amount),
    method: payment.method, reference: payment.reference, loanNumber: loan.loanNumber,
    clientId: loan.client, outstandingBWP: fromThebe(outstanding(loan)),
    allocated: { charges: fromThebe(allocatedCharges), interest: fromThebe(allocatedInterest), principal: fromThebe(allocatedPrincipal) }
  });
});

router.get('/:id/payments', async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  res.json(await Payment.find({ loan: loan._id }).populate('receivedBy', 'name').sort({ receivedAt: -1 }));
});

// Manual trigger makes overdue assessment testable without relying on a background scheduler.
// Safe to run repeatedly: one charge per loan/periodKey.
router.post('/assess-overdue', allowRoles('MANAGER','ADMIN'), async (req, res) => {
  const now = new Date();
  const loans = await Loan.find({ status: 'DISBURSED', dueDate: { $lt: now } });
  const assessed = [];
  for (const loan of loans) {
    let balance = outstanding(loan);
    if (balance <= 0) continue;
    const firstOverdue = new Date(loan.dueDate);
    firstOverdue.setDate(firstOverdue.getDate() + 1);
    const dueSlots = [];
    let slot = new Date(firstOverdue);
    while (slot <= now) {
      dueSlots.push(new Date(slot));
      slot = nextMonthlyAnniversary(firstOverdue, dueSlots.length);
      if (dueSlots.length > 240) break;
    }
    let changed = false;
    for (const slotDate of dueSlots) {
      const periodKey = `${loan._id}:${slotDate.getFullYear()}-${String(slotDate.getMonth()+1).padStart(2,'0')}-${String(slotDate.getDate()).padStart(2,'0')}`;
      if (loan.overdueAssessments.some(a => a.periodKey === periodKey)) continue;
      balance = outstanding(loan);
      if (balance <= 0) break;
      // Charge 25% of remaining unpaid balance, rounded to the nearest thebe.
      const charge = Math.round(balance * 0.25);
      if (charge <= 0) continue;
      loan.chargesTotal += charge;
      loan.overdueAssessments.push({ periodKey, assessedAt: now, baseBalance: balance, rate: 25, amount: charge });
      loan.lastOverdueAssessmentAt = now;
      assessed.push({ loanNumber: loan.loanNumber, periodKey, chargeBWP: fromThebe(charge) });
      changed = true;
    }
    if (changed) {
      await loan.save();
      await audit(req, 'OVERDUE_CHARGES_ASSESSED', 'Loan', loan._id, { assessments: loan.overdueAssessments.map(a => ({ periodKey: a.periodKey, amountBWP: fromThebe(a.amount) })) });
    }
  }
  res.json({ assessedCount: assessed.length, assessments: assessed });
});

function nextMonthlyAnniversary(first, monthOffset) {
  const target = new Date(first);
  const originalDay = first.getDate();
  target.setDate(1);
  target.setMonth(first.getMonth() + monthOffset);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(originalDay, lastDay));
  return target;
}

export default router;
