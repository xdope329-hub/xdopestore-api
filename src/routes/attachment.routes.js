const router = require('express').Router();
const { uploadLimiter } = require('../middleware/rateLimiters');
const Attachment = require('../models/Attachment');
const auth = require('../middleware/auth');
const adminOnly = require('../middleware/adminOnly');
const { multer, cloudinary, ensureCloudinaryConfigured } = require('../middleware/upload');
const { getUsedAttachmentIds } = require('../utils/attachmentUsage');

const isAttachmentUsed = ({ usedIds, usedUrls }, att) =>
  usedIds.has(String(att._id)) || (att.original_url && usedUrls.has(att.original_url));

// POST /attachment
router.post('/', auth, adminOnly, uploadLimiter, multer.any(), async (req, res) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) return res.status(422).json({ message: 'No file uploaded' });

  const created = await Promise.all(files.map(async (file) => {
    const asset_url = file.path; // Cloudinary secure URL
    return Attachment.create({
      name: file.originalname,
      file_name: file.filename,
      mime_type: file.mimetype,
      path: file.filename,       // Cloudinary public_id
      asset_url,
      original_url: asset_url,
      created_by_id: req.user._id,
    });
  }));

  res.status(201).json(created.length === 1 ? created[0] : { data: created });
});

// GET /attachment — paginated list with an `is_used` flag per item so the
// Media page can badge attachments that are still wired to a product,
// setting, theme option, preset, etc.
router.get('/', auth, adminOnly, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.paginate) || 20;
  const total = await Attachment.countDocuments();
  const [rows, usage] = await Promise.all([
    Attachment.find().skip((page - 1) * limit).limit(limit).sort({ createdAt: -1 }),
    getUsedAttachmentIds(),
  ]);
  const data = rows.map((r) => {
    const obj = r.toJSON();
    obj.is_used = isAttachmentUsed(usage, r);
    return obj;
  });
  res.json({ current_page: page, last_page: Math.ceil(total / limit), total, per_page: limit, data });
});

// Cloudinary's destroy() does NOT accept resource_type 'auto' — it must be
// 'image', 'video' or 'raw', so we derive it from the stored mime type.
function cloudinaryResourceType(mimeType) {
  if (!mimeType) return 'image';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'raw'; // pdf, zip, etc.
}

async function deleteAttachment(att) {
  if (att.path) {
    try {
      ensureCloudinaryConfigured();
      const result = await cloudinary.uploader.destroy(att.path, {
        resource_type: cloudinaryResourceType(att.mime_type),
        invalidate: true,
      });
      if (result?.result && result.result !== 'ok' && result.result !== 'not found') {
        console.warn(`[attachment] Cloudinary destroy '${att.path}': ${result.result}`);
      }
    } catch (err) {
      // The DB record is still removed so the media library stays usable;
      // the orphaned Cloudinary file can be cleaned up manually.
      console.warn(`[attachment] Cloudinary destroy failed for '${att.path}': ${err.message}`);
    }
  }
  await att.deleteOne();
}

// DELETE /attachment/deleteAll  — bulk delete.
// Refuses (409) if any target is in use, unless `?force=true`. The response
// lists which IDs were skipped so the UI can show a clear message.
router.delete('/deleteAll', auth, adminOnly, async (req, res) => {
  const ids = req.body.ids || [];
  const force = req.query.force === 'true' || req.body.force === true;
  const attachments = await Attachment.find({ _id: { $in: ids } });

  let toDelete = attachments;
  let skipped = [];
  if (!force) {
    const usage = await getUsedAttachmentIds();
    toDelete = attachments.filter((a) => !isAttachmentUsed(usage, a));
    skipped = attachments.filter((a) => isAttachmentUsed(usage, a)).map((a) => String(a._id));
    if (toDelete.length === 0 && skipped.length > 0) {
      return res.status(409).json({
        message: 'All selected attachments are in use',
        skipped,
      });
    }
  }
  await Promise.all(toDelete.map(deleteAttachment));
  res.json({
    message: `${toDelete.length} attachment(s) deleted${skipped.length ? `, ${skipped.length} skipped (in use)` : ''}`,
    deleted: toDelete.map((a) => String(a._id)),
    skipped,
  });
});

// DELETE /attachment/:id  — single delete. Refuses (409) if in use unless
// `?force=true`. The UI's default action should NOT pass force.
router.delete('/:id', auth, adminOnly, async (req, res) => {
  const att = await Attachment.findById(req.params.id);
  if (!att) return res.status(404).json({ message: 'Attachment not found' });

  const force = req.query.force === 'true';
  if (!force) {
    const usage = await getUsedAttachmentIds();
    if (isAttachmentUsed(usage, att)) {
      return res.status(409).json({ message: 'Attachment is in use and cannot be deleted' });
    }
  }
  await deleteAttachment(att);
  res.json({ message: 'Attachment deleted' });
});

module.exports = router;
