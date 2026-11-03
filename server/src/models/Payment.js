import mongoose from 'mongoose';
const paymentSchema = new mongoose.Schema({
  receiptNumber: { type: String, unique: true, required: true },
  loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  amount: { type: Number, required: true }, // thebe
  allocatedCharges: { type: Number, default: 0 },
  allocatedInterest: { type: Number, default: 0 },
  allocatedPrincipal: { type: Number, default: 0 },
  method: { type: String, enum: ['CASH','BANK_TRANSFER','MOBILE_MONEY','OTHER'], required: true },
  reference: { type: String, default: '' },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receivedAt: { type: Date, default: Date.now }
}, { timestamps: true });
export default mongoose.model('Payment', paymentSchema);
