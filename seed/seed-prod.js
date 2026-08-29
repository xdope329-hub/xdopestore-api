require('dotenv').config();
const mongoose = require('mongoose');
const slugify = require('slugify');

const Role        = require('../src/models/Role');
const User        = require('../src/models/User');
const Attachment  = require('../src/models/Attachment');
const Category    = require('../src/models/Category');
const Attribute   = require('../src/models/Attribute');
const Tax         = require('../src/models/Tax');
const OrderStatus = require('../src/models/OrderStatus');
const Shipping    = require('../src/models/Shipping');
const Page        = require('../src/models/Page');
const Setting     = require('../src/models/Setting');
const Homepage    = require('../src/models/Homepage');
const ThemeOption = require('../src/models/ThemeOption');
const Menu        = require('../src/models/Menu');

/**
 * SEMILLA DE PRODUCCIÓN — solo lo esencial, CERO datos de relleno.
 *
 * Crea únicamente lo que la tienda necesita para funcionar:
 *   roles, usuario admin, configuración (COP, IVA, pagos), estados de pedido,
 *   envíos, atributos (Talla/Color), categoría Hoodies, menú, opciones del
 *   tema, páginas legales y una página de inicio con las secciones apagadas.
 *
 * NO crea: productos demo, clientes demo, pedidos, reseñas, blogs, cupones,
 * notificaciones ni imágenes de relleno (picsum). Los productos reales se
 * crean después desde el admin.
 *
 * Igual que seed.js, BORRA las colecciones primero, con la misma guarda:
 * contra una base no vacía exige --force.
 *
 * Uso:  npm run seed:prod            (solo si la base está vacía)
 *       npm run seed:prod -- --force (reemplaza una base existente)
 */
async function seedProd() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado a MongoDB');

  const FORCE = process.argv.includes('--force') || process.env.SEED_FORCE === '1';
  if (!FORCE) {
    let existingDocs = 0;
    for (const col of Object.values(mongoose.connection.collections)) {
      existingDocs += await col.countDocuments();
    }
    if (existingDocs > 0) {
      console.error('');
      console.error('⛔  La base de datos NO está vacía (' + existingDocs + ' documentos).');
      console.error('    Esta semilla BORRA TODO y deja solo la configuración base de producción.');
      console.error('    Si de verdad quieres reemplazarla:  npm run seed:prod -- --force');
      console.error('');
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
  console.log('Colecciones limpiadas');

  // ── Roles ─────────────────────────────────────────────────────────────────────
  const [adminRole] = await Role.insertMany([
    { name: 'admin',    system_reserve: '1' },
    { name: 'consumer', system_reserve: '0' },
  ]);

  // ── Estados de pedido ─────────────────────────────────────────────────────────
  await OrderStatus.insertMany([
    { name: 'Pendiente',  slug: 'pending',          sequence: 1, color: '#f59e0b', system_reserve: '1' },
    { name: 'Procesando', slug: 'processing',       sequence: 2, color: '#3b82f6', system_reserve: '0' },
    { name: 'Enviado',    slug: 'shipped',          sequence: 3, color: '#8b5cf6', system_reserve: '0' },
    { name: 'En Camino',  slug: 'out_for_delivery', sequence: 4, color: '#06b6d4', system_reserve: '0' },
    { name: 'Entregado',  slug: 'delivered',        sequence: 5, color: '#10b981', system_reserve: '1' },
    { name: 'Cancelado',  slug: 'cancelled',        sequence: 6, color: '#ef4444', system_reserve: '1' },
  ]);

  // ── Usuario administrador (solo este, ningún cliente demo) ────────────────────
  const adminUser = await User.create({
    name: 'Super Admin',
    email: process.env.ADMIN_EMAIL || 'admin@xdope.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@123',
    role: adminRole._id,
    status: 1, system_reserve: '1',
    email_verified_at: new Date(),
  });

  // ── Configuración general ─────────────────────────────────────────────────────
  await Setting.create({
    values: {
      general: {
        site_name: 'XDOPE Store',
        site_tagline: 'Hoodies con Bordado',
        site_title: 'XDOPE — Hoodies Bordados',
        site_url: process.env.FRONTEND_URL || 'http://localhost:3001',
        copyright: '© 2026 XDOPE Store. Todos los derechos reservados.',
        default_currency: {
          name: 'Peso Colombiano', code: 'COP', symbol: '$',
          symbol_position: 'before_price', exchange_rate: 1,
        },
        default_language: 'es',
        mode: 'light-only',
        admin_site_language_direction: 'ltr',
        front_site_language_direction: 'ltr',
      },
      activation: {
        guest_checkout: true,
        multivendor: false,
        product_auto_approve: true,
        wallet_enable: true,
        coupon_enable: true,
        point_enable: false,
        stock_product_hide: false,
      },
      maintenance: { maintenance_mode: false },
      delivery: {
        estimated_delivery_text: '3–5 días hábiles',
        same_day_delivery: false,
        default: { title: 'Envío estándar', description: '3–5 días hábiles' },
        same_day: { title: 'Entrega el mismo día', description: 'Antes de las 8pm' },
      },
      payment_methods: [
        { name: 'cod', status: 1 },
        { name: 'mercadopago', status: 1 },
      ],
    },
  });

  // ── IVA ───────────────────────────────────────────────────────────────────────
  await Tax.create({ name: 'IVA', rate: 19, status: 1 });

  // ── Atributos reales para hoodies ─────────────────────────────────────────────
  await Attribute.create({
    name: 'Talla', slug: 'talla', status: 1,
    attribute_values: [
      { value: 'XS',  slug: 'xs'  },
      { value: 'S',   slug: 's'   },
      { value: 'M',   slug: 'm'   },
      { value: 'L',   slug: 'l'   },
      { value: 'XL',  slug: 'xl'  },
      { value: 'XXL', slug: 'xxl' },
    ],
  });
  await Attribute.create({
    name: 'Color', slug: 'color', status: 1,
    attribute_values: [
      { value: 'Negro',  slug: 'negro',  hex_color: '#1a1a1a' },
      { value: 'Blanco', slug: 'blanco', hex_color: '#ffffff' },
      { value: 'Gris',   slug: 'gris',   hex_color: '#9e9e9e' },
      { value: 'Beige',  slug: 'beige',  hex_color: '#f5f0e8' },
    ],
  });

  // ── Categoría real ────────────────────────────────────────────────────────────
  const cHoodies = await Category.create({
    name: 'Hoodies', slug: 'hoodies', type: 'product', status: 1,
    created_by_id: adminUser._id,
  });

  // ── Envíos ────────────────────────────────────────────────────────────────────
  await Shipping.create({
    status: 1,
    country: 'Colombia', country_id: 48,
    zones: [
      { zone: 1, name: 'Zona 1 — Ciudades principales', amount: 9900 },
      { zone: 2, name: 'Zona 2 — Resto del país', amount: 14900 },
    ],
    free_shipping_threshold: 200000,
    shipping_rules: [
      { name: 'Envío Estándar (5–7 días hábiles)', type: 'flat', amount: 9900  },
      { name: 'Envío Express (2–3 días hábiles)',  type: 'flat', amount: 19900 },
      { name: 'Envío al Día Siguiente',            type: 'flat', amount: 34900 },
      { name: 'Envío Gratis (pedidos +$200.000)',  type: 'free', amount: 0     },
    ],
    created_by_id: adminUser._id,
  });

  // ── Menú ──────────────────────────────────────────────────────────────────────
  await Menu.insertMany([
    { title: 'Inicio',   path: '/', class: '0', status: 1, sort_order: 0 },
    { title: 'Hoodies',  path: `/collections?category=${cHoodies.slug}`, class: '0', status: 1, sort_order: 1 },
    { title: 'Contacto', path: '/contact-us', class: '0', status: 1, sort_order: 2 },
  ]);

  // ── Logo y opciones del tema ──────────────────────────────────────────────────
  const logoImg = await Attachment.create({
    name: 'xdope-logo.svg', file_name: 'xdope-logo.svg', mime_type: 'image/svg+xml',
    original_url: '/xdope-logo.svg', asset_url: '/xdope-logo.svg',
  });
  await ThemeOption.create({
    options: {
      general: { primary_color: '#2c1810', secondary_color: '#c9a96e', mode: 'light-only' },
      logo: {
        header_logo:  { id: logoImg._id, original_url: logoImg.original_url },
        footer_logo:  { id: logoImg._id, original_url: logoImg.original_url },
        favicon_icon: { id: logoImg._id, original_url: logoImg.original_url },
      },
      header: { header_options: 'classic_header', sticky_header_enable: true, header_border_enable: false },
      footer: {
        footer_copyright: '© 2026 XDOPE Store. Todos los derechos reservados.',
        support_number: '+57 310 555 0147',
        support_email: 'soporte@xdope.com',
        useful_link: [
          { id: 1, name: 'Home',        value: '' },
          { id: 2, name: 'Collections', value: 'collections' },
          { id: 3, name: 'Contact Us',  value: 'contact-us' },
        ],
        help_center: [
          { id: 1, name: 'My Account',         value: 'account/dashboard' },
          { id: 2, name: 'My Orders',          value: 'account/order' },
          { id: 3, name: 'TermsAndConditions', value: 'terms-and-conditions' },
          { id: 4, name: 'PrivacyPolicy',      value: 'privacy-policy' },
        ],
      },
      collection: { collection_layout: 'collection_left_sidebar', product_per_page: 12 },
      product: { product_layout: 'product_images', product_box: 'product_box_one', product_box_variant: 'product_box_one', show_trending_label: true, show_sale_label: true },
      seo: {
        meta_tags:        'XDOPE Store — Hoodies con Bordado, Colombia',
        meta_description: 'Hoodies con diseños bordados hechos en Colombia. Envío a todo el país.',
        og_title:         'XDOPE Store',
        og_description:   'Hoodies con diseños bordados. Envío a toda Colombia.',
      },
      popup: { news_letter: { status: false, title: '', content: '' } },
    },
  });

  // ── Página de inicio: secciones apagadas hasta configurarlas en el admin ─────
  const homeConfig = {
    products_ids: [],
    home_banner:      { status: 0, banners: [] },
    offer_banner:     { banner_1: { status: 0 }, banner_2: { status: 0 } },
    products_list:    { status: 0, title: '', tag: '', product_ids: [] },
    category_product: { status: 0, title: '', tag: '', category_ids: [] },
    brands:           { brand_ids: [] },
    services:         { status: 0, banners: [] },
    parallax_banner:  { status: 0 },
  };
  await Homepage.insertMany([
    { slug: 'fashion_one', config: homeConfig },
    { slug: 'default',     config: homeConfig },
  ]);

  // ── Páginas legales ───────────────────────────────────────────────────────────
  // Reutiliza seed-pages.js para no duplicar el contenido legal.
  console.log('Base creada. Insertando páginas legales…');
  await mongoose.disconnect();
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [require('path').join(__dirname, 'seed-pages.js')], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);

  console.log('');
  console.log('✅ Semilla de PRODUCCIÓN completada — sin datos de relleno.');
  console.log('━'.repeat(50));
  console.log('Admin: ' + (process.env.ADMIN_EMAIL || 'admin@xdope.com'));
  console.log('Siguiente paso: crea tus hoodies reales desde el admin (Productos)');
  console.log('y configura la página de inicio (Theme → Homepage).');
  console.log('━'.repeat(50));
}

seedProd().catch((err) => { console.error(err); process.exit(1); });
