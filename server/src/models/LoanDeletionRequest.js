import mongoose from 'mongoose';

const loanDeletionRequestSchema = new mongoose.Schema({
  loan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Loan',
    required: true
  },

  loanNumber: {
    type: String,
    required: true
  },

  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  requestedByName: {
    type: String,
    required: true
  },

  reason: {
    type: String,
    required: true,
    trim: true
  },

  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },

  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  reviewedByName: {
    type: String,
    default: ''
  },

  reviewNote: {
    type: String,
    default: ''
  },

  reviewedAt: {
    type: Date,
    default: null
  },

  executedAt: {
    type: Date,
    default: null
  }

}, { timestamps: true });

loanDeletionRequestSchema.index({ loan: 1, status: 1 });

export default mongoose.model(
  'LoanDeletionRequest',
  loanDeletionRequestSchema
);