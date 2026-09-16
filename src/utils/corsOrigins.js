/**
 * Orígenes permitidos por CORS. Módulo puro; testeable sin Express.
 *
 *  - Localhost de las tres apps en desarrollo.
 *  - FRONTEND_URL y CORS_ORIGINS (lista separada por comas), validados como
 *    URLs http(s) — un valor mal escrito no abre la puerta a nada.
 *  - Despliegues de Vercel SOLO de los proyectos conocidos del equipo
 *    (VERCEL_PROJECTS, por defecto la tienda y el admin), incluidas sus
 *    previews. Antes valía cualquier proyecto del equipo.
 */
const LOCAL_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];
const VERCEL_TEAM = 'xdope-s-projects';
const DEFAULT_VERCEL_PROJECTS = ['xdopestore', 'admin-dashboard'];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseOriginList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/[^/\s]+$/i.test(s));
}

function buildAllowedOrigins(env = process.env) {
  const configured = [].concat(parseOriginList(env.FRONTEND_URL)).concat(parseOriginList(env.CORS_ORIGINS));
  const projects = String(env.VERCEL_PROJECTS || DEFAULT_VERCEL_PROJECTS.join(','))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9-]+$/.test(s));
  const vercelPattern = projects.length
    ? new RegExp(`^https://(${projects.map(escapeRegex).join('|')})(-[a-z0-9-]+)?-${VERCEL_TEAM}\\.vercel\\.app$`)
    : null;
  const allowList = new Set(LOCAL_ORIGINS.concat(configured));
  return {
    list: Array.from(allowList),
    isAllowed: (origin) => allowList.has(origin) || Boolean(vercelPattern && vercelPattern.test(origin)),
  };
}

module.exports = { buildAllowedOrigins, parseOriginList, LOCAL_ORIGINS, DEFAULT_VERCEL_PROJECTS };
