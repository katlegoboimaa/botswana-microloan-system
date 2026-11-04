import mongoose from 'mongoose';
const loanSchema = new mongoose.Schema({
  loanNumber: { type: String, unique: true, required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  principal: { type: Number, required: true }, // thebe
  interestRate: { type: Number, default: 25, min: 0, max: 100 }, // percent of original principal, flat
  interest: { type: Number, required: true }, // thebe
  amountDueAtStart: { type: Number, required: true }, // principal + initial interest
  dueDate: { type: Date, required: true },
  originalDisbursementDate: { type: Date, default: null },
  isHistorical: { type: Boolean, default: false },
  originalLoanNumber: { type: String, default: '' },
  purpose: { type: String, required: true },
  status: {
  type: String,
  enum: ['PENDING', 'APPROVED', 'REJECTED', 'DISBURSED', 'SETTLED', 'VOIDED'],
  default: 'PENDING'
   },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  voidReason: { type: String, default: '' },
  decisionNote: { type: String, default: '' },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
  disbursedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  disbursedAt: Date,
  chargesTotal: { type: Number, default: 0 }, // thebe
  paymentsTotal: { type: Number, default: 0 }, // thebe
  principalPaid: { type: Number, default: 0 }, // thebe
  interestPaid: { type: Number, default: 0 }, // thebe
  chargesPaid: { type: Number, default: 0 }, // thebe
  overdueAssessments: [{
    periodKey: String,
    assessedAt: Date,
    baseBalance: Number,
    rate: Number,
    amount: Number
  }],
  lastOverdueAssessmentAt: Date,
  settledAt: Date
}, { timestamps: true });
loanSchema.index({ status: 1, dueDate: 1 });
export default mongoose.model('Loan', loanSchema);
