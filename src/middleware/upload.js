const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Cloudinary config + storage are built lazily on first use, NOT at require
// time. That way a missing CLOUDINARY_* env var doesn't crash the entire
// server at boot - it only breaks the upload route, and only when it's hit.
let cachedStorage = null;
let cachedUpload = null;
let configured = false;

function ensureCloudinaryConfigured() {
  if (configured) return;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  configured = true;
}

function getStorage() {
  if (cachedStorage) return cachedStorage;
  ensureCloudinaryConfigured();
  cachedStorage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'xdope-store',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'zip'],
      resource_type: 'auto',
    },
  });
  return cachedStorage;
}

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'application/zip',
  ];
  cb(null, allowed.includes(file.mimetype));
};

// upload.any() / upload.single(...) / etc. - route handlers call these
// methods at request time, which goes through getStorage() above.
const upload = new Proxy({}, {
  get(_target, method) {
    if (!cachedUpload) {
      cachedUpload = multer({
        storage: getStorage(),
        fileFilter,
        limits: { fileSize: 10 * 1024 * 1024 },
      });
    }
    const v = cachedUpload[method];
    return typeof v === 'function' ? v.bind(cachedUpload) : v;
  },
});

module.exports = { multer: upload, cloudinary };
