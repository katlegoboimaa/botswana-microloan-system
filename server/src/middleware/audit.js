import AuditLog from '../models/AuditLog.js';

export async function audit(req, action, entityType, entityId, details = {}) {
  try {
    await AuditLog.create({
      actor: req.user?._id,
      actorName: req.user?.name || 'System',
      actorRole: req.user?.role || 'SYSTEM',
      action, entityType, entityId: entityId ? String(entityId) : '',
      details,
      ip: req.ip,
      userAgent: req.get('user-agent') || ''
    });
  } catch (err) {
    // Audit failures should be logged and investigated; never silently mutate the log.
    console.error('AUDIT LOG WRITE FAILED:', err.message);
    throw new Error('Audit log write failed; action could not be safely completed');
  }
}
