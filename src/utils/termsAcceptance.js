const { createHash } = require('node:crypto');
const Page = require('../models/Page');
const bundledTerms = require('../data/legal/terms-2026-08-27.json');

const TERMS_PATH = '/terms-and-conditions';
const BUNDLED_TERMS_VERSION = 'bundled-2026-08-27';

async function currentTerms() {
  const page = await Page.findOne({ slug: 'terms-and-conditions', status: 1 });
  if (page?.content) {
    const content = JSON.stringify({ title: page.title, content: page.content });
    return { version: `cms-${createHash('sha256').update(content).digest('hex')}`, path: TERMS_PATH, source: 'cms', content };
  }
  return { version: BUNDLED_TERMS_VERSION, path: TERMS_PATH, source: 'bundled', content: JSON.stringify(bundledTerms) };
}

async function requireTermsAcceptance(body = {}) {
  if (body.terms_accepted !== true) {
    throw Object.assign(new Error('Debes aceptar los Términos y Condiciones para realizar tu pedido'), { status: 422, code: 'TERMS_ACCEPTANCE_REQUIRED' });
  }
  const terms = await currentTerms();
  if (body.terms_version !== terms.version) {
    throw Object.assign(new Error('Los Términos y Condiciones han cambiado. Revísalos y acéptalos de nuevo'), { status: 422, code: 'TERMS_VERSION_CHANGED' });
  }
  // Only server-owned fields enter the evidence. Never accept client timestamps
  // or a client-supplied snapshot; retain the text even after the CMS is edited.
  return { accepted: true, accepted_at: new Date(), ...terms };
}

module.exports = { currentTerms, requireTermsAcceptance, BUNDLED_TERMS_VERSION };
