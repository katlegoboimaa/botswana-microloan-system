import mongoose from 'mongoose';
const clientSchema = new mongoose.Schema({
  clientNumber: { type: String, unique: true, required: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  nationalId: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, trim: true, default: '' },
  address: { type: String, required: true, trim: true },
  employment: { type: String, default: '' },
  notes: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
clientSchema.index({ nationalId: 1 }, { unique: true });
clientSchema.index({ firstName: 'text', lastName: 'text', clientNumber: 'text', phone: 'text' });
export default mongoose.model('Client', clientSchema);
