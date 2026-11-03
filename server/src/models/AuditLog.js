import mongoose from 'mongoose';
const auditSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName: String,
  actorRole: String,
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: String,
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: String,
  userAgent: String
}, { timestamps: true });
auditSchema.index({ createdAt: -1 });
export default mongoose.model('AuditLog', auditSchema);
