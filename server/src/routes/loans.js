import { Router } from 'express';
import Loan from '../models/Loan.js';
import Client from '../models/Client.js';
import Payment from '../models/Payment.js';
import LoanDeletionRequest from '../models/LoanDeletionRequest.js';
import AuditLog from '../models/AuditLog.js';
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

// Import a historical loan with its original repayments.
// Historical charges and repayments are processed chronologically.
router.post('/historical', allowRoles('MANAGER', 'ADMIN'), async (req, res) => {
  const {
    clientId,
    principal,
    interestRate = 25,
    dueDate,
    disbursedAt,
    purpose,
    originalLoanNumber = '',
    payments = []
  } = req.body;

  if (!clientId || !principal || !dueDate || !disbursedAt || !purpose) {
    return res.status(400).json({
      message: 'Client, principal, due date, original disbursement date and purpose are required'
    });
  }

  if (!Array.isArray(payments)) {
    return res.status(400).json({ message: 'Payments must be an array' });
  }

  const client = await Client.findById(clientId);
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const principalThebe = toThebe(principal);
  const rate = Number(interestRate);
  const due = new Date(dueDate);
  const disbursement = new Date(disbursedAt);
  const now = new Date();

  if (!Number.isFinite(principalThebe) || principalThebe <= 0) {
    return res.status(400).json({ message: 'Principal must be greater than zero' });
  }

  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return res.status(400).json({ message: 'Interest rate must be between 0 and 100 percent' });
  }

  if (
    Number.isNaN(due.getTime()) ||
    Number.isNaN(disbursement.getTime()) ||
    due <= disbursement ||
    disbursement > now
  ) {
    return res.status(400).json({ message: 'Enter valid historical disbursement and due dates' });
  }

  const interest = Math.round(principalThebe * rate / 100);
  const amountDueAtStart = principalThebe + interest;

  // Validate and prepare historical repayments.
  const preparedPayments = [];

  for (const p of payments) {
    const amount = toThebe(p.amount);
    const receivedAt = new Date(p.receivedAt);

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Number.isNaN(receivedAt.getTime()) ||
      receivedAt < disbursement ||
      receivedAt > now
    ) {
      return res.status(400).json({
        message: 'Every historical payment needs a valid amount and date between disbursement and today'
      });
    }

    if (!['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER'].includes(p.method)) {
      return res.status(400).json({ message: 'A historical payment has an invalid payment method' });
    }

    preparedPayments.push({
      amount,
      receivedAt,
      method: p.method,
      reference: String(p.reference || '').slice(0, 150)
    });
  }

  // Build overdue assessment dates.
  const firstOverdue = new Date(due);
  firstOverdue.setDate(firstOverdue.getDate() + 1);

  const events = [];
  let slot = new Date(firstOverdue);
  let slotCount = 0;

  while (slot <= now) {
    events.push({ type: 'CHARGE', date: new Date(slot) });
    slotCount++;

    if (slotCount > 240) {
      return res.status(400).json({ message: 'Historical loan exceeds the supported overdue assessment period' });
    }

    slot = nextMonthlyAnniversary(firstOverdue, slotCount);
  }

  preparedPayments.forEach((payment, index) => {
    events.push({
      type: 'PAYMENT',
      date: payment.receivedAt,
      index
    });
  });

  // Process events in date order. Assess charges before payments
  // if both events have exactly the same timestamp.
  events.sort((a, b) =>
    a.date.getTime() - b.date.getTime() ||
    (a.type === 'CHARGE' ? -1 : 1)
  );

  let chargesTotal = 0;
  let paymentsTotal = 0;
  let chargesPaid = 0;
  let interestPaid = 0;
  let principalPaid = 0;

  const assessments = [];
  const paymentRecords = [];

  function currentBalance() {
    return Math.max(0, amountDueAtStart + chargesTotal - paymentsTotal);
  }

  for (const event of events) {
    if (event.type === 'CHARGE') {
      const balance = currentBalance();

      if (balance <= 0) continue;

      const charge = Math.round(balance * 0.25);

      if (charge > 0) {
        chargesTotal += charge;
        assessments.push({
          date: event.date,
          baseBalance: balance,
          amount: charge
        });
      }

      continue;
    }

    const payment = preparedPayments[event.index];
    const balance = currentBalance();

    if (balance <= 0) {
      return res.status(400).json({
        message: 'A historical payment occurs after the loan was already fully settled'
      });
    }

    if (payment.amount > balance) {
      return res.status(400).json({
        message: `A historical payment exceeds the balance on ${payment.receivedAt.toISOString().slice(0, 10)}`
      });
    }

    let remaining = payment.amount;

    const allocatedCharges = Math.min(remaining, chargesTotal - chargesPaid);
    remaining -= allocatedCharges;

    const allocatedInterest = Math.min(remaining, interest - interestPaid);
    remaining -= allocatedInterest;

    const allocatedPrincipal = Math.min(remaining, principalThebe - principalPaid);
    remaining -= allocatedPrincipal;

    if (remaining > 0) {
      return res.status(400).json({ message: 'Could not allocate a historical payment correctly' });
    }

    chargesPaid += allocatedCharges;
    interestPaid += allocatedInterest;
    principalPaid += allocatedPrincipal;
    paymentsTotal += payment.amount;

    paymentRecords.push({
      ...payment,
      allocatedCharges,
      allocatedInterest,
      allocatedPrincipal
    });
  }

  // Create the historical loan with its final calculated balances.
  let loan;

  try {
    loan = await Loan.create({
      loanNumber: `HL-${Date.now()}`,
      originalLoanNumber: String(originalLoanNumber).slice(0, 100),
      isHistorical: true,
      client: client._id,
      principal: principalThebe,
      interestRate: rate,
      interest,
      amountDueAtStart,
      dueDate: due,
      originalDisbursementDate: disbursement,
      purpose: String(purpose).trim(),
      submittedBy: req.user._id,
      disbursedBy: req.user._id,
      disbursedAt: disbursement,
      status: currentBalance() === 0 ? 'SETTLED' : 'DISBURSED',
      chargesTotal,
      paymentsTotal,
      chargesPaid,
      interestPaid,
      principalPaid,
      settledAt: currentBalance() === 0 ? paymentRecords[paymentRecords.length - 1]?.receivedAt : null,
      overdueAssessments: assessments.map(a => ({
        periodKey: `${Date.now()}:${a.date.getFullYear()}-${String(a.date.getMonth() + 1).padStart(2, '0')}-${String(a.date.getDate()).padStart(2, '0')}`,
        assessedAt: a.date,
        baseBalance: a.baseBalance,
        rate: 25,
        amount: a.amount
      })),
      lastOverdueAssessmentAt: assessments.length
        ? assessments[assessments.length - 1].date
        : null
    });

    const paymentDocuments = paymentRecords.map(p => ({
      receiptNumber: `RC-H-${Date.now()}-${Math.floor(Math.random() * 900000 + 100000)}`,
      loan: loan._id,
      client: client._id,
      amount: p.amount,
      allocatedCharges: p.allocatedCharges,
      allocatedInterest: p.allocatedInterest,
      allocatedPrincipal: p.allocatedPrincipal,
      method: p.method,
      reference: p.reference,
      receivedBy: req.user._id,
      receivedAt: p.receivedAt
    }));

    if (paymentDocuments.length) {
      await Payment.insertMany(paymentDocuments);
    }

    await audit(req, 'HISTORICAL_LOAN_IMPORTED', 'Loan', loan._id, {
      loanNumber: loan.loanNumber,
      originalLoanNumber,
      paymentsImported: paymentDocuments.length,
      chargesBWP: fromThebe(chargesTotal),
      outstandingBWP: fromThebe(currentBalance())
    });

    res.status(201).json(loanSummary(loan));

  } catch (error) {
    if (loan) {
      await Payment.deleteMany({ loan: loan._id });
      await Loan.deleteOne({ _id: loan._id });
    }

    throw error;
  }
});

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

/* =========================================
   LOAN DELETION REQUEST WORKFLOW
========================================= */

// ADMIN submits a deletion request
router.post(
  '/:id/deletion-request',
  allowRoles('ADMIN'),
  async (req, res) => {
    const session = await Loan.startSession();

    try {
      const reason = String(req.body.reason || '').trim();

      if (!reason) {
        return res.status(400).json({ message: 'A deletion reason is required.' });
      }

      const loan = await Loan.findById(req.params.id);

      if (!loan) {
        return res.status(404).json({ message: 'Loan not found.' });
      }

      if (loan.status === 'VOIDED') {
        return res.status(400).json({ message: 'This loan has already been voided.' });
      }

      const existingRequest = await LoanDeletionRequest.findOne({
        loan: loan._id,
        status: 'PENDING'
      });

      if (existingRequest) {
        return res.status(409).json({
          message: 'A pending deletion request already exists for this loan.'
        });
      }

      let createdRequest;

      await session.withTransaction(async () => {
        const [request] = await LoanDeletionRequest.create([{
          loan: loan._id,
          loanNumber: loan.loanNumber,
          requestedBy: req.user._id,
          requestedByName: req.user.name,
          reason
        }], { session });

        await AuditLog.create([{
          actor: req.user._id,
          actorName: req.user.name || 'System',
          actorRole: req.user.role,
          action: 'LOAN_DELETION_REQUESTED',
          entityType: 'Loan',
          entityId: loan._id.toString(),
          details: {
            loanNumber: loan.loanNumber,
            reason
          },
          ip: req.ip,
          userAgent: req.get('user-agent') || ''
        }], { session });

        createdRequest = request;
      });

      res.status(201).json({
        message: 'Deletion request submitted successfully. A Manager must review it.',
        request: createdRequest
      });

    } catch (err) {
      console.error('LOAN DELETION REQUEST ERROR:', err);
      res.status(500).json({ message: 'Could not submit deletion request.' });
    } finally {
      await session.endSession();
    }
  }
);


// ADMIN and MANAGER can view deletion requests
router.get(
  '/deletion-requests',
  allowRoles('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const requests = await LoanDeletionRequest.find({})
        .populate('loan')
        .sort({ createdAt: -1 });

      res.json(requests);

    } catch (err) {
      console.error('FETCH DELETION REQUESTS ERROR:', err);
      res.status(500).json({ message: 'Could not retrieve deletion requests.' });
    }
  }
);


// MANAGER approves or rejects a deletion request
router.post(
  '/deletion-requests/:requestId/review',
  allowRoles('MANAGER'),
  async (req, res) => {
    const session = await Loan.startSession();

    try {
      const decision = String(req.body.decision || '').toUpperCase();
      const reviewNote = String(req.body.reviewNote || '').trim();

      if (!['APPROVE', 'REJECT'].includes(decision)) {
        return res.status(400).json({
          message: 'Decision must be APPROVE or REJECT.'
        });
      }

      let result;

      await session.withTransaction(async () => {
        const request = await LoanDeletionRequest.findById(
          req.params.requestId
        ).session(session);

        if (!request) {
          const error = new Error('Deletion request not found.');
          error.status = 404;
          throw error;
        }

        if (request.status !== 'PENDING') {
          const error = new Error('This request has already been reviewed.');
          error.status = 409;
          throw error;
        }

        if (request.requestedBy.toString() === req.user._id.toString()) {
          const error = new Error('You cannot approve your own deletion request.');
          error.status = 403;
          throw error;
        }

        const loan = await Loan.findById(request.loan).session(session);

        if (!loan) {
          const error = new Error('The loan no longer exists.');
          error.status = 404;
          throw error;
        }

        let executionResult = 'REQUEST_REJECTED';

        if (decision === 'APPROVE') {
          const hasPayments = await Payment.exists({
            loan: loan._id
          }).session(session);

          if (hasPayments) {
            loan.status = 'VOIDED';
            loan.voidedAt = new Date();
            loan.voidedBy = req.user._id;
            loan.voidReason = request.reason;

            await loan.save({ session });

            executionResult = 'LOAN_VOIDED';
          } else {
            await Loan.deleteOne(
              { _id: loan._id },
              { session }
            );

            executionResult = 'LOAN_PERMANENTLY_DELETED';
          }
        }

        request.status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        request.reviewedBy = req.user._id;
        request.reviewedByName = req.user.name;
        request.reviewNote = reviewNote;
        request.reviewedAt = new Date();

        if (decision === 'APPROVE') {
          request.executedAt = new Date();
        }

        await request.save({ session });

        await AuditLog.create([{
          actor: req.user._id,
          actorName: req.user.name || 'System',
          actorRole: req.user.role,
          action: decision === 'APPROVE'
            ? 'LOAN_DELETION_APPROVED'
            : 'LOAN_DELETION_REJECTED',
          entityType: 'Loan',
          entityId: loan._id.toString(),
          details: {
            loanNumber: request.loanNumber,
            requestId: request._id.toString(),
            reviewNote,
            executionResult
          },
          ip: req.ip,
          userAgent: req.get('user-agent') || ''
        }], { session });

        result = {
          message: decision === 'REJECT'
            ? 'Deletion request rejected.'
            : executionResult === 'LOAN_VOIDED'
              ? 'Loan voided successfully. Repayment history has been preserved.'
              : 'Loan permanently deleted successfully.',
          executionResult,
          requestId: request._id
        };
      });

      res.json(result);

    } catch (err) {
      console.error('LOAN DELETION REVIEW ERROR:', err);

      res.status(err.status || 500).json({
        message: err.status
          ? err.message
          : 'Could not process the deletion request.'
      });

    } finally {
      await session.endSession();
    }
  }
);

export default router;
